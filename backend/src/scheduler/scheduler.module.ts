import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Monitor } from '../monitors/monitor.entity';
import { SqsModule } from '../queue/sqs.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [TypeOrmModule.forFeature([Monitor]), SqsModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
