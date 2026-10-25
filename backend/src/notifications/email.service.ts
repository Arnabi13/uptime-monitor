import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const SES_CLIENT = Symbol('SES_CLIENT');

/**
 * Sends the "your monitor went down / recovered" emails via SES.
 *
 * SES starts every new AWS account in sandbox mode: it can only send to
 * addresses you've individually verified, and ALERT_EMAIL_FROM itself must
 * be a verified identity. Until that's set up, alerts are just logged —
 * nothing in the worker depends on email actually going out.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly from?: string;

  constructor(
    @Optional() @Inject(SES_CLIENT) private readonly client: SESv2Client | undefined,
    config: ConfigService,
  ) {
    this.from = config.get<string>('ALERT_EMAIL_FROM') || undefined;
  }

  async sendDownAlert(to: string, monitorName: string, url: string, cause: string): Promise<void> {
    await this.send(
      to,
      `🔴 ${monitorName} is down`,
      `${monitorName} (${url}) failed its last ${process.env.ALERT_FAILURE_THRESHOLD ?? 3} checks.\nReason: ${cause}`,
    );
  }

  async sendRecoveryAlert(to: string, monitorName: string, url: string): Promise<void> {
    await this.send(to, `🟢 ${monitorName} is back up`, `${monitorName} (${url}) is responding normally again.`);
  }

  private async send(to: string, subject: string, body: string): Promise<void> {
    if (!this.from || !this.client) {
      this.logger.log(`[email alert skipped — SES not configured] to=${to} subject="${subject}"`);
      return;
    }
    try {
      await this.client.send(
        new SendEmailCommand({
          FromEmailAddress: this.from,
          Destination: { ToAddresses: [to] },
          Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: body } } } },
        }),
      );
    } catch (err) {
      // Never let a failed email take down the worker — log and move on.
      this.logger.warn(`Failed to send alert email to ${to}: ${(err as Error).message}`);
    }
  }
}
