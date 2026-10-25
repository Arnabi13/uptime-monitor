import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Monitor } from '../monitors/monitor.entity';

/**
 * One row per check the worker runs. This is what powers the response-time
 * chart, uptime percentages and the status page's daily bars.
 *
 * It's the fastest-growing table by far (a 60s monitor writes 1,440 rows a day),
 * so it's kept lean: bigint id instead of uuid, no text columns on the hot path
 * except a short failure cause, and old rows are deleted daily (see
 * SchedulerService.pruneOldChecks).
 */
@Entity({ name: 'checks' })
// "Last N checks for monitor X" and "checks for monitor X since T" — the two
// queries every dashboard view makes — both walk this index.
@Index('idx_checks_monitor_time', ['monitorId', 'checkedAt'])
export class Check {
  // bigint comes back from pg as a string; we never expose this id anyway.
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'monitor_id', type: 'uuid' })
  monitorId: string;

  @ManyToOne(() => Monitor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'monitor_id' })
  monitor: Monitor;

  @CreateDateColumn({ name: 'checked_at', type: 'timestamptz' })
  checkedAt: Date;

  @Column({ name: 'is_up', type: 'boolean' })
  isUp: boolean;

  /** null when the request never got a response (timeout, DNS failure, refused). */
  @Column({ name: 'response_time_ms', type: 'int', nullable: true })
  responseTimeMs: number | null;

  @Column({ name: 'status_code', type: 'smallint', nullable: true })
  statusCode: number | null;

  /** Only stored for failures, e.g. "timeout", "unexpected HTTP 503". */
  @Column({ type: 'varchar', length: 255, nullable: true })
  cause: string | null;
}
