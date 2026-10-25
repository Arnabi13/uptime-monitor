import { SQSClient } from '@aws-sdk/client-sqs';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SQS_CLIENT, SqsService } from './sqs.service';

@Module({
  providers: [
    {
      provide: SQS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const region = config.getOrThrow<string>('AWS_REGION');
        const accessKeyId = config.get<string>('AWS_ACCESS_KEY_ID');
        const secretAccessKey = config.get<string>('AWS_SECRET_ACCESS_KEY');
        // When keys aren't set (EC2 in production), the SDK falls back to the
        // instance's IAM role automatically — passing `credentials: undefined` here
        // is what triggers that default chain.
        return new SQSClient({
          region,
          credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
        });
      },
    },
    SqsService,
  ],
  exports: [SqsService],
})
export class SqsModule {}
