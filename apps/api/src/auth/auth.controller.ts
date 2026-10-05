import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  LoginInput, RegisterInput, forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema, tokenSchema,
} from '@ielts/validation';
import { z } from 'zod';
import { AppError } from '../common/app-error';
import { AuthUser, CurrentUser, Public, clientMeta } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { APP_CONFIG, AppConfig } from '../config/config.module';
import { AuthService, Session } from './auth.service';
import { MfaService } from './mfa.service';
import { COOKIE, SkipCsrf } from './guards';
import { clearSessionCookies, setSessionCookies } from './cookies';
import { GoogleCredentials, googleAuthorizationUrl, googleProfileFromCode } from './google';
import { randomToken } from './tokens';

const mfaCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });
const emailOnly = z.object({ email: z.string().trim().toLowerCase().email() });
const GOOGLE_STATE_COOKIE = 'google_oauth_state';
const GOOGLE_NEXT_COOKIE = 'google_oauth_next';
const OAUTH_COOKIE_OPTIONS = { httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge: 10 * 60_000 };

/** Only same-site relative paths survive a round trip through the browser. */
const safeNext = (next: string | undefined) => (next && next.startsWith('/') && !next.startsWith('//') ? next : undefined);

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

  @Public() @Get('providers')
  providers() { return { google: this.googleCredentials() !== null }; }

  @Public() @Get('google/start')
  googleStart(@Query('next') next: string | undefined, @Res() res: Response) {
    const creds = this.googleCredentials();
    if (!creds) throw new NotFoundException();
    const state = randomToken(24);
    res.cookie(GOOGLE_STATE_COOKIE, state, OAUTH_COOKIE_OPTIONS);
    res.cookie(GOOGLE_NEXT_COOKIE, safeNext(next) ?? '', OAUTH_COOKIE_OPTIONS);
    res.redirect(googleAuthorizationUrl(creds, this.googleRedirectUri(), state));
  }

  @Public() @Get('google/callback')
  async googleCallback(
    @Query('code') code: string | undefined, @Query('state') state: string | undefined, @Req() req: Request, @Res() res: Response,
  ) {
    const expected = req.cookies?.[GOOGLE_STATE_COOKIE] as string | undefined;
    const next = safeNext(req.cookies?.[GOOGLE_NEXT_COOKIE] as string | undefined);
    res.clearCookie(GOOGLE_STATE_COOKIE, { path: '/' });
    res.clearCookie(GOOGLE_NEXT_COOKIE, { path: '/' });
    const creds = this.googleCredentials();
    if (!creds || !code || !state || !expected || state !== expected) return res.redirect(`${this.config.APP_URL}/login?error=google`);
    try {
      const profile = await googleProfileFromCode(creds, code, this.googleRedirectUri());
      this.setCookies(res, await this.auth.signInWithGoogle(profile, clientMeta(req)));
      const query = new URLSearchParams({ google: '1' });
      if (next) query.set('next', next);
      return res.redirect(`${this.config.APP_URL}/login?${query.toString()}`);
    } catch (e) {
      const reason = e instanceof AppError ? e.code : 'GOOGLE_SIGNIN_FAILED';
      return res.redirect(`${this.config.APP_URL}/login?${new URLSearchParams({ error: 'google', reason }).toString()}`);
    }
  }

  private googleCredentials(): GoogleCredentials | null {
    const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } = this.config;
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  }

  private googleRedirectUri() { return `${this.config.APP_URL}/api/auth/google/callback`; }

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
