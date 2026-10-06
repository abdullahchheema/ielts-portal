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

  /** Sends one email. Never throws: the result says whether the provider accepted it, and carries the provider's message id. */
  async send(to: string, subject: string, html: string): Promise<{ ok: boolean; providerId?: string; error?: string }> {
    if (!this.client) {
      this.logger.log(`[email:dev] to=${to} subject="${subject}"
${html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`);
      return { ok: true, providerId: 'dev-console' };
    }
    try {
      const { data, error } = await this.client.emails.send({ from: this.config.MAIL_FROM, to, subject, html });
      if (error) {
        this.logger.error(`Email to ${to} failed: ${error.message}`);
        return { ok: false, error: error.message.slice(0, 300) };
      }
      return { ok: true, providerId: data?.id };
    } catch (e) {
      const error = (e as Error).message.slice(0, 300);
      this.logger.error(`Email to ${to} failed: ${error}`);
      return { ok: false, error };
    }
  }
}
