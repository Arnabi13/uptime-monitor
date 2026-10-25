import { SESv2Client } from '@aws-sdk/client-sesv2';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService, SES_CLIENT } from './email.service';

@Module({
  providers: [
    {
      provide: SES_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const region = config.getOrThrow<string>('AWS_REGION');
        const accessKeyId = config.get<string>('AWS_ACCESS_KEY_ID');
        const secretAccessKey = config.get<string>('AWS_SECRET_ACCESS_KEY');
        return new SESv2Client({
          region,
          credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
        });
      },
    },
    EmailService,
  ],
  exports: [EmailService],
})
export class EmailModule {}
