import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export enum MonitorMethod {
  HEAD = 'HEAD',
  GET = 'GET',
}

export enum MonitorStatus {
  PENDING = 'pending', // created, not checked yet
  UP = 'up',
  DOWN = 'down',
  PAUSED = 'paused',
}

@Entity({ name: 'monitors' })
@Unique('uq_monitors_user_url', ['userId', 'url'])
@Check('chk_monitors_interval', '"interval_seconds" >= 60')
@Check('chk_monitors_timeout', '"timeout_ms" BETWEEN 1000 AND 30000')
// The Day 2 scheduler asks "which active monitors are due now?" every minute.
// This index makes that query cheap even with thousands of monitors.
@Index('idx_monitors_due', ['isActive', 'nextCheckAt'])
export class Monitor {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // No separate index on user_id: the unique (user_id, url) constraint already
  // creates an index whose leftmost column is user_id, so lookups by user use it.
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** Normalised URL (see UrlSafetyService). */
  @Column({ type: 'varchar', length: 2048 })
  url: string;

  /** Lowercased hostname, stored separately so per-host limits are a simple count. */
  @Column({ type: 'varchar', length: 253 })
  host: string;

  @Column({ type: 'enum', enum: MonitorMethod, default: MonitorMethod.HEAD })
  method: MonitorMethod;

  @Column({ name: 'interval_seconds', type: 'int', default: 300 })
  intervalSeconds: number;

  @Column({ name: 'timeout_ms', type: 'int', default: 10000 })
  timeoutMs: number;

  /** null = any 2xx/3xx counts as "up". */
  @Column({ name: 'expected_status_code', type: 'int', nullable: true })
  expectedStatusCode: number | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /** Shown on the owner's public status page. Off by default: opt in per monitor. */
  @Column({ name: 'is_public', type: 'boolean', default: false })
  isPublic: boolean;

  @Column({ type: 'enum', enum: MonitorStatus, default: MonitorStatus.PENDING })
  status: MonitorStatus;

  @Column({ name: 'last_checked_at', type: 'timestamptz', nullable: true })
  lastCheckedAt: Date | null;

  /** Resets to 0 on any successful check. Drives incident open/close. */
  @Column({ name: 'consecutive_failures', type: 'int', default: 0 })
  consecutiveFailures: number;

  @Column({ name: 'next_check_at', type: 'timestamptz', default: () => 'now()' })
  nextCheckAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
