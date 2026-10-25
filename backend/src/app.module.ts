import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { validateEnv } from './config/env.validation';
import { buildTypeOrmOptions } from './database/typeorm.config';
import { HealthController } from './health/health.controller';
import { IncidentsModule } from './incidents/incidents.module';
import { MonitorsModule } from './monitors/monitors.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { StatusPageModule } from './status-page/status-page.module';
import { UsersModule } from './users/users.module';
import { WorkerModule } from './worker/worker.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Env is already validated by ConfigModule at this point.
    TypeOrmModule.forRootAsync({ useFactory: () => buildTypeOrmOptions(process.env) }),
    // Global default: 100 requests per minute per IP. Auth routes override with a stricter limit.
    // (Skipped in automated tests, which create many accounts from one IP.)
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 100 }],
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
    ScheduleModule.forRoot(),
    UsersModule,
    AuthModule,
    MonitorsModule,
    IncidentsModule,
    StatusPageModule,
    SchedulerModule,
    WorkerModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
