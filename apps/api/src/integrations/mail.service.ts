import { Inject, Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, AppConfig } from '../config/config.module';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly client?: Resend;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig, private readonly audit: AuditService) {
    if (config.RESEND_API_KEY) this.client = new Resend(config.RESEND_API_KEY);
    else this.logger.warn('RESEND_API_KEY not set — emails are logged to the console instead of sent.');
  }

  /** Sends one email. Never throws: the result says whether the provider accepted it, and carries the provider's message id. */
  async send(to: string, subject: string, html: string): Promise<{ ok: boolean; providerId?: string; error?: string }> {
    if (!this.client) {
      // `warn`, not `log`: a stubbed send is a real degradation (nobody receives this email), not
      // routine info, so it has to stand out in log severity filtering, not just scroll by.
      this.logger.warn(`[email:stub] would have sent to=${to} subject="${subject}" — no provider configured`);
      // Best-effort usage signal for command-center's "N emails only logged, last 24h" alert — never
      // let a logging failure here affect whether the (already-degraded) send reports ok.
      await this.audit.record({ action: 'EMAIL_STUBBED', entityType: 'Email', after: { to, subject } }).catch(() => undefined);
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
