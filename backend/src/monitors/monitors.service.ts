import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Not, QueryFailedError, Repository } from 'typeorm';
import { UrlSafetyService } from '../common/url-safety/url-safety.service';
import { User } from '../users/user.entity';
import { CreateMonitorDto, UpdateMonitorDto } from './dto/monitor.dto';
import { Monitor, MonitorStatus } from './monitor.entity';

const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class MonitorsService {
  private readonly maxPerUser: number;
  private readonly maxPerHost: number;

  constructor(
    @InjectRepository(Monitor) private readonly monitors: Repository<Monitor>,
    private readonly dataSource: DataSource,
    private readonly urlSafety: UrlSafetyService,
    config: ConfigService,
  ) {
    this.maxPerUser = Number(config.get('MAX_MONITORS_PER_USER', 10));
    this.maxPerHost = Number(config.get('MAX_MONITORS_PER_HOST', 3));
  }

  list(userId: string): Promise<Monitor[]> {
    return this.monitors.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  /**
   * Scoped to the owner. Someone else's monitor gives 404, not 403,
   * so the API never confirms that an id exists for another user.
   */
  async findOne(userId: string, id: string): Promise<Monitor> {
    const monitor = await this.monitors.findOne({ where: { id, userId } });
    if (!monitor) throw new NotFoundException('Monitor not found');
    return monitor;
  }

  async create(userId: string, dto: CreateMonitorDto): Promise<Monitor> {
    // DNS + private-IP checks happen before we open a transaction (they're slow-ish network calls).
    const safe = await this.urlSafety.assertSafe(dto.url);

    return this.withUniqueGuard(() =>
      this.dataSource.transaction(async (tx) => {
        await this.lockUser(tx, userId);

        const total = await tx.count(Monitor, { where: { userId } });
        if (total >= this.maxPerUser) {
          throw new ForbiddenException(`Monitor limit reached (${this.maxPerUser} per account)`);
        }
        await this.assertHostLimit(tx, userId, safe.host);

        const monitor = tx.create(Monitor, {
          userId,
          name: dto.name.trim(),
          url: safe.url,
          host: safe.host,
          method: dto.method,
          intervalSeconds: dto.intervalSeconds,
          timeoutMs: dto.timeoutMs,
          expectedStatusCode: dto.expectedStatusCode ?? null,
          isPublic: dto.isPublic ?? false,
          nextCheckAt: new Date(), // check it straight away
        });
        return tx.save(monitor);
      }),
    );
  }

  async update(userId: string, id: string, dto: UpdateMonitorDto): Promise<Monitor> {
    const safe = dto.url !== undefined ? await this.urlSafety.assertSafe(dto.url) : null;

    return this.withUniqueGuard(() =>
      this.dataSource.transaction(async (tx) => {
        await this.lockUser(tx, userId);
        const monitor = await tx.findOne(Monitor, { where: { id, userId } });
        if (!monitor) throw new NotFoundException('Monitor not found');

        let reschedule = false;

        if (safe && safe.url !== monitor.url) {
          if (safe.host !== monitor.host) {
            await this.assertHostLimit(tx, userId, safe.host, monitor.id);
          }
          monitor.url = safe.url;
          monitor.host = safe.host;
          monitor.status = monitor.isActive ? MonitorStatus.PENDING : MonitorStatus.PAUSED;
          reschedule = true;
        }
        if (dto.name !== undefined) monitor.name = dto.name.trim();
        if (dto.method !== undefined) monitor.method = dto.method;
        if (dto.timeoutMs !== undefined) monitor.timeoutMs = dto.timeoutMs;
        if (dto.expectedStatusCode !== undefined) monitor.expectedStatusCode = dto.expectedStatusCode;
        if (dto.isPublic !== undefined) monitor.isPublic = dto.isPublic;
        if (dto.intervalSeconds !== undefined && dto.intervalSeconds !== monitor.intervalSeconds) {
          monitor.intervalSeconds = dto.intervalSeconds;
          reschedule = true;
        }
        if (dto.isActive !== undefined && dto.isActive !== monitor.isActive) {
          monitor.isActive = dto.isActive;
          monitor.status = dto.isActive ? MonitorStatus.PENDING : MonitorStatus.PAUSED;
          reschedule = true;
        }
        if (reschedule) monitor.nextCheckAt = new Date();

        return tx.save(monitor);
      }),
    );
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.monitors.delete({ id, userId });
    if (!result.affected) throw new NotFoundException('Monitor not found');
  }

  /**
   * Row lock on the user. Without it, two "create monitor" requests sent at the
   * same moment could both count 9, both pass the limit check, and both insert
   * (11 monitors). With the lock, the second request waits until the first commits.
   */
  private async lockUser(tx: EntityManager, userId: string): Promise<void> {
    await tx
      .createQueryBuilder(User, 'u')
      .setLock('pessimistic_write')
      .where('u.id = :userId', { userId })
      .getOne();
  }

  /** Stops one account from pointing lots of monitors at the same site. */
  private async assertHostLimit(
    tx: EntityManager,
    userId: string,
    host: string,
    excludeMonitorId?: string,
  ): Promise<void> {
    const sameHost = await tx.count(Monitor, {
      where: { userId, host, ...(excludeMonitorId ? { id: Not(excludeMonitorId) } : {}) },
    });
    if (sameHost >= this.maxPerHost) {
      throw new ForbiddenException(
        `You can have at most ${this.maxPerHost} monitors for the same host (${host})`,
      );
    }
  }

  /** Turns the (user_id, url) unique-constraint error into a friendly 409. */
  private async withUniqueGuard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof QueryFailedError && (err as any).driverError?.code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException('You are already monitoring this URL');
      }
      throw err;
    }
  }
}
