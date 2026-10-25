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
 * One row per down period. Opened when a monitor crosses the failure
 * threshold, resolved when it next succeeds. A monitor has at most one
 * open (resolvedAt IS NULL) incident at a time.
 */
@Entity({ name: 'incidents' })
@Index('idx_incidents_monitor_open', ['monitorId', 'resolvedAt'])
export class Incident {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'monitor_id', type: 'uuid' })
  monitorId: string;

  @ManyToOne(() => Monitor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'monitor_id' })
  monitor: Monitor;

  /** Short reason captured from the failing check, e.g. "HTTP 503", "timeout". */
  @Column({ name: 'cause', type: 'varchar', length: 255 })
  cause: string;

  @CreateDateColumn({ name: 'opened_at', type: 'timestamptz' })
  openedAt: Date;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;
}
