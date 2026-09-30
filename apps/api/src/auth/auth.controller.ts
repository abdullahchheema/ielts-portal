import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  LoginInput, RegisterInput, forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema, tokenSchema,
} from '@ielts/validation';
import { z } from 'zod';
import { AuthUser, CurrentUser, Public, clientMeta } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { APP_CONFIG, AppConfig } from '../config/config.module';
import { AuthService, Session } from './auth.service';
import { MfaService } from './mfa.service';
import { COOKIE, SkipCsrf } from './guards';
import { clearSessionCookies, setSessionCookies } from './cookies';

const mfaCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });
const emailOnly = z.object({ email: z.string().trim().toLowerCase().email() });

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private setCookies(res: Response, s: Session) {
    setSessionCookies(res, s, this.config.NODE_ENV === 'production');
  }

  private clearCookies(res: Response) {
    clearSessionCookies(res);
  }

  @Public() @SkipCsrf() @Post('register')
  register(@Body(new ZodPipe(registerSchema)) body: RegisterInput, @Req() req: Request) {
    return this.auth.register(body, clientMeta(req));
  }

  @Public() @SkipCsrf() @HttpCode(200) @Post('verify-email')
  async verifyEmail(@Body(new ZodPipe(tokenSchema)) body: { token: string }) {
    await this.auth.verifyEmail(body.token);
    return { ok: true };
  }

  @Public() @SkipCsrf() @HttpCode(200) @Post('resend-verification')
  async resend(@Body(new ZodPipe(emailOnly)) body: { email: string }) {
    await this.auth.resendVerification(body.email);
    return { ok: true };
  }

  @Public() @SkipCsrf() @HttpCode(200) @Post('login')
  async login(@Body(new ZodPipe(loginSchema)) body: LoginInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { session, user } = await this.auth.login(body, clientMeta(req));
    this.setCookies(res, session);
    return { user };
  }

  @Public() @HttpCode(200) @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const session = await this.auth.refresh(req.cookies?.[COOKIE.refresh], clientMeta(req));
      this.setCookies(res, session);
      return { ok: true };
    } catch (e) {
      this.clearCookies(res);
      throw e;
    }
  }

  @Public() @HttpCode(200) @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[COOKIE.refresh]);
    this.clearCookies(res);
    return { ok: true };
  }

  @Public() @SkipCsrf() @HttpCode(200) @Post('forgot-password')
  async forgot(@Body(new ZodPipe(forgotPasswordSchema)) body: { email: string }) {
    await this.auth.forgotPassword(body.email);
    return { ok: true };
  }

  @Public() @SkipCsrf() @HttpCode(200) @Post('reset-password')
  async reset(@Body(new ZodPipe(resetPasswordSchema)) body: { token: string; password: string }) {
    await this.auth.resetPassword(body.token, body.password);
    return { ok: true };
  }

  @Post('mfa/setup')
  mfaSetup(@CurrentUser() user: AuthUser) {
    return this.mfa.setup(user.id, user.email);
  }

  @HttpCode(200) @Post('mfa/confirm')
  async mfaConfirm(@Body(new ZodPipe(mfaCodeSchema)) body: { code: string }, @CurrentUser() user: AuthUser, @Req() req: Request) {
    await this.mfa.confirm(user.id, body.code, clientMeta(req));
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }
}
