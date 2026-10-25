import {
  DeleteMessageCommand,
  Message,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const SQS_CLIENT = Symbol('SQS_CLIENT');

export interface CheckJob {
  monitorId: string;
}

/**
 * Thin wrapper around the SQS SDK. Kept small and injectable so the worker
 * and scheduler can be unit tested with a fake client instead of real AWS.
 */
@Injectable()
export class SqsService {
  private readonly logger = new Logger(SqsService.name);
  private readonly queueUrl: string;

  constructor(
    @Inject(SQS_CLIENT) private readonly client: SQSClient,
    config: ConfigService,
  ) {
    this.queueUrl = config.getOrThrow<string>('SQS_QUEUE_URL');
  }

  async enqueueCheck(job: CheckJob): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(job),
      }),
    );
  }

  /** Long-polls for up to `waitSeconds` so the worker loop doesn't hammer SQS when idle. */
  async receive(maxMessages = 10, waitSeconds = 20): Promise<Message[]> {
    const result = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: maxMessages,
        WaitTimeSeconds: waitSeconds,
        VisibilityTimeout: 30,
      }),
    );
    return result.Messages ?? [];
  }

  async delete(receiptHandle: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: receiptHandle }),
      );
    } catch (err) {
      // Not fatal: the message will just reappear after its visibility timeout
      // and be reprocessed (checks are idempotent), or eventually hit the DLQ.
      this.logger.warn(`Failed to delete SQS message: ${(err as Error).message}`);
    }
  }
}
