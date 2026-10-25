import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Message } from '@aws-sdk/client-sqs';
import { DataSource, IsNull } from 'typeorm';
import { UrlSafetyService } from '../common/url-safety/url-safety.service';
import { Check } from '../checks/check.entity';
import { Incident } from '../incidents/incident.entity';
import { Monitor, MonitorStatus } from '../monitors/monitor.entity';
import { EmailService } from '../notifications/email.service';
import { CheckJob, SqsService } from '../queue/sqs.service';
import { CheckResult, HttpCheckService } from './http-check.service';

/**
 * Consumes check jobs from SQS. For each one: re-validates the URL (DNS can
 * have changed since the monitor was created or last checked — "DNS
 * rebinding"), makes the actual request pinned to the IP it just validated,
 * then updates the monitor's status and opens/resolves incidents.
 *
 * Runs as a long-poll loop inside the same process as the API (fine for a
 * single EC2 instance — see Day 4). Not a @Cron: SQS long polling already
 * blocks efficiently when the queue is empty, so a plain loop is simpler and
 * reacts the moment a job arrives instead of waiting for the next tick.
 */
@Injectable()
export class WorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerService.name);
  private readonly enabled: boolean;
  private readonly failureThreshold: number;
  private running = false;
  private loopPromise: Promise<void> | null = null;

  constructor(
    private readonly sqs: SqsService,
    private readonly urlSafety: UrlSafetyService,
    private readonly httpCheck: HttpCheckService,
    private readonly email: EmailService,
    private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    this.enabled = config.get('ENABLE_WORKER') !== false;
    this.failureThreshold = config.get<number>('ALERT_FAILURE_THRESHOLD') ?? 3;
  }

  onModuleInit() {
    if (!this.enabled) return;
    this.running = true;
    this.logger.log('Worker enabled — polling SQS for check jobs.');
    this.loopPromise = this.loop();
  }

  async onModuleDestroy() {
    this.running = false;
    await this.loopPromise; // let the current long-poll / in-flight job finish
  }

  private async loop(): Promise<void> {
    while (this.running) {
      let messages: Message[];
      try {
        messages = await this.sqs.receive();
      } catch (err) {
        this.logger.error(`Failed to poll SQS: ${(err as Error).message}`);
        await new Promise((r) => setTimeout(r, 5000)); // back off before retrying
        continue;
      }

      for (const message of messages) {
        await this.handleMessage(message);
      }
    }
  }

  private async handleMessage(message: Message): Promise<void> {
    if (!message.Body || !message.ReceiptHandle) return;

    let job: CheckJob;
    try {
      job = JSON.parse(message.Body);
    } catch {
      this.logger.warn('Discarding malformed SQS message (not JSON).');
      await this.sqs.delete(message.ReceiptHandle);
      return;
    }

    try {
      await this.runJob(job);
    } catch (err) {
      // Don't delete the message: let it become visible again and retry.
      // After enough retries SQS's redrive policy moves it to the DLQ.
      this.logger.error(`Check failed for monitor ${job.monitorId}: ${(err as Error).message}`);
      return;
    }

    await this.sqs.delete(message.ReceiptHandle);
  }

  /** Public so tests can process a job directly, without going through SQS. */
  async runJob(job: CheckJob): Promise<void> {
    const monitor = await this.dataSource
      .getRepository(Monitor)
      .findOne({ where: { id: job.monitorId }, relations: { user: true } });

    // Deleted or paused since the scheduler enqueued it — nothing to do.
    if (!monitor || !monitor.isActive) return;

    const result = await this.runCheck(monitor);
    await this.applyResult(monitor, result);
  }

  private async runCheck(monitor: Monitor): Promise<CheckResult> {
    try {
      // Re-resolves DNS right now and re-verifies every address is public —
      // the Day 1 guard isn't enough on its own because the DNS answer for
      // this hostname could have changed since the monitor was created.
      const safe = await this.urlSafety.assertSafe(monitor.url);
      return await this.httpCheck.check({
        url: safe.url,
        pinnedIp: safe.addresses[0],
        method: monitor.method,
        timeoutMs: monitor.timeoutMs,
        expectedStatusCode: monitor.expectedStatusCode,
      });
    } catch (err) {
      // assertSafe throws BadRequestException if DNS now fails or now points
      // somewhere private — that's a real down condition, not a bug.
      return { up: false, cause: (err as Error).message ?? 'URL safety check failed' };
    }
  }

  private async applyResult(monitor: Monitor, result: CheckResult): Promise<void> {
    await this.dataSource.transaction(async (tx) => {
      const monitors = tx.getRepository(Monitor);
      const incidentsRepo = tx.getRepository(Incident);

      monitor.lastCheckedAt = new Date();

      // History row for charts / uptime %. Same transaction as the status
      // update, so the chart and the status badge can never disagree.
      await tx.getRepository(Check).insert({
        monitorId: monitor.id,
        isUp: result.up,
        responseTimeMs: result.responseTimeMs ?? null,
        statusCode: result.statusCode ?? null,
        cause: result.up ? null : result.cause.slice(0, 255),
      });

      if (result.up) {
        monitor.status = MonitorStatus.UP;
        monitor.consecutiveFailures = 0;
        await monitors.save(monitor);

        const open = await incidentsRepo.findOne({
          where: { monitorId: monitor.id, resolvedAt: IsNull() },
        });
        if (open) {
          open.resolvedAt = new Date();
          await incidentsRepo.save(open);
          await this.email.sendRecoveryAlert(monitor.user.email, monitor.name, monitor.url);
        }
        return;
      }

      monitor.status = MonitorStatus.DOWN;
      monitor.consecutiveFailures += 1;
      await monitors.save(monitor);

      // Open exactly one incident (and send exactly one alert) per down period —
      // not one per failed check, which would spam the inbox every interval.
      if (monitor.consecutiveFailures === this.failureThreshold) {
        const incident = incidentsRepo.create({
          monitorId: monitor.id,
          cause: result.cause,
          resolvedAt: null,
        });
        await incidentsRepo.save(incident);
        await this.email.sendDownAlert(monitor.user.email, monitor.name, monitor.url, result.cause);
      }
    });
  }
}
