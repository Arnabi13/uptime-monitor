import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { DataSource } from 'typeorm';

/**
 * GET /api/health — used by Docker's healthcheck, Nginx, and (Day 5) by the
 * app monitoring itself. Returns 503 if the database can't be reached, so a
 * "healthy" result means the app can actually serve requests.
 */
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  async check(): Promise<{ status: 'ok'; db: 'up'; uptimeSeconds: number }> {
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException({ status: 'error', db: 'down' });
    }
    return { status: 'ok', db: 'up', uptimeSeconds: Math.round(process.uptime()) };
  }
}
