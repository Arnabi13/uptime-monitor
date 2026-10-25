import { Module } from '@nestjs/common';
import { PublicStatusController, StatusPageController } from './status-page.controller';
import { StatusPageService } from './status-page.service';

@Module({
  controllers: [StatusPageController, PublicStatusController],
  providers: [StatusPageService],
})
export class StatusPageModule {}
