import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UrlSafetyModule } from '../common/url-safety/url-safety.module';
import { Incident } from '../incidents/incident.entity';
import { MonitorStatsService } from './monitor-stats.service';
import { Monitor } from './monitor.entity';
import { MonitorsController } from './monitors.controller';
import { MonitorsService } from './monitors.service';

@Module({
  imports: [TypeOrmModule.forFeature([Monitor, Incident]), UrlSafetyModule],
  controllers: [MonitorsController],
  providers: [MonitorsService, MonitorStatsService],
})
export class MonitorsModule {}
