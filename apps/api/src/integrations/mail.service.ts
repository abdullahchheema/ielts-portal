import { Inject, Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { APP_CONFIG, AppConfig } from '../config/config.module';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly client?: Resend;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    if (config.RESEND_API_KEY) this.client = new Resend(config.RESEND_API_KEY);
    else this.logger.warn('RESEND_API_KEY not set — emails are logged to the console instead of sent.');
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    if (!this.client) {
      this.logger.log(`[email:dev] to=${to} subject="${subject}"\n${html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`);
      return;
    }
    const { error } = await this.client.emails.send({ from: this.config.MAIL_FROM, to, subject, html });
    if (error) this.logger.error(`Email to ${to} failed: ${error.message}`);
  }
}
