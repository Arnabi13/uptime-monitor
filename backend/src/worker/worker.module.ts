import { Module } from '@nestjs/common';
import { UrlSafetyModule } from '../common/url-safety/url-safety.module';
import { EmailModule } from '../notifications/email.module';
import { SqsModule } from '../queue/sqs.module';
import { HttpCheckService } from './http-check.service';
import { WorkerService } from './worker.service';

@Module({
  imports: [SqsModule, UrlSafetyModule, EmailModule],
  providers: [WorkerService, HttpCheckService],
})
export class WorkerModule {}
