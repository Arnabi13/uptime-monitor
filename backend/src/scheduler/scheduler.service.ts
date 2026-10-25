import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, LessThanOrEqual } from 'typeorm';
import { Monitor } from '../monitors/monitor.entity';
import { SqsService } from '../queue/sqs.service';

const CLAIM_BATCH_SIZE = 50;

/** One day more than the longest range anything displays (30 days). */
export const CHECK_RETENTION_DAYS = 31;
const PRUNE_BATCH_SIZE = 5_000;

/**
 * Runs every minute. Finds active monitors whose next_check_at has passed,
 * claims them (advances next_check_at immediately so a slow cycle or a second
 * scheduler instance can't pick the same monitor twice), and enqueues one SQS
 * job per monitor for the worker to actually check.
 */
@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly dataSource: DataSource,
    private readonly sqs: SqsService,
    config: ConfigService,
  ) {
    this.enabled = config.get('ENABLE_SCHEDULER') !== false;
  }

  onModuleInit() {
    if (this.enabled) {
      this.logger.log('Scheduler enabled — scanning for due monitors every minute.');
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (!this.enabled) return;

    const claimed = await this.claimDueMonitors();
    if (claimed.length === 0) return;

    this.logger.log(`Claimed ${claimed.length} due monitor(s), enqueueing checks.`);
    for (const monitor of claimed) {
      try {
        await this.sqs.enqueueCheck({ monitorId: monitor.id });
      } catch (err) {
        // The monitor's next_check_at is already advanced, so a failed enqueue
        // just means this one check is skipped — it'll be picked up next cycle.
        this.logger.error(
          `Failed to enqueue check for monitor ${monitor.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * SELECT ... FOR UPDATE SKIP LOCKED so that if this ever runs as more than
   * one instance, two schedulers can't claim the same monitor in the same tick.
   */
  private async claimDueMonitors(): Promise<Monitor[]> {
    return this.dataSource.transaction(async (tx) => {
      const due = await tx
        .createQueryBuilder(Monitor, 'm')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where('m.isActive = :active', { active: true })
        .andWhere('m.nextCheckAt <= :now', { now: new Date() })
        .orderBy('m.nextCheckAt', 'ASC')
        .limit(CLAIM_BATCH_SIZE)
        .getMany();

      if (due.length === 0) return [];

      const now = new Date();
      for (const monitor of due) {
        monitor.nextCheckAt = new Date(now.getTime() + monitor.intervalSeconds * 1000);
      }
      await tx.save(due);
      return due;
    });
  }

  /**
   * The checks table grows forever otherwise (1,440 rows/day per 60s monitor).
   * Deletes in batches of 5,000 so no single statement holds locks for long or
   * builds up a huge transaction — the worker keeps inserting while this runs.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async pruneOldChecks(): Promise<void> {
    if (!this.enabled) return;
    const deleted = await this.deleteOldChecks();
    if (deleted > 0) this.logger.log(`Pruned ${deleted} check(s) older than ${CHECK_RETENTION_DAYS} days.`);
  }

  /** Public so tests can call it directly (the cron is off in tests). */
  async deleteOldChecks(): Promise<number> {
    let deleted = 0;
    for (;;) {
      const result: [unknown[], number] = await this.dataSource.query(
        `DELETE FROM checks
          WHERE id IN (
            SELECT id FROM checks
             WHERE checked_at < now() - interval '${CHECK_RETENTION_DAYS} days'
             LIMIT ${PRUNE_BATCH_SIZE})`,
      );
      const affected = result[1];
      deleted += affected;
      if (affected < PRUNE_BATCH_SIZE) break;
    }
    return deleted;
  }
}
