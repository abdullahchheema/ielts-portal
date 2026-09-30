import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { timingSafeEqual } from 'node:crypto';
import { AppError, forbidden } from '../common/app-error';
import { IS_PUBLIC, PERMISSIONS_KEY, AuthUser } from '../common/decorators';
import { isAdminRole } from '../common/roles';
import { APP_CONFIG, AppConfig } from '../config/config.module';
import { UserContextService } from '../roles/user-context.service';

export const SKIP_CSRF = 'skipCsrf';
export const SkipCsrf = () => SetMetadata(SKIP_CSRF, true);

export const COOKIE = { access: 'access_token', refresh: 'refresh_token', csrf: 'csrf_token' } as const;

/** Global: every route needs a valid access token unless marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly ctxService: UserContextService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    const req = context.switchToHttp().getRequest();

    const bearer = /^Bearer (.+)$/i.exec(String(req.headers.authorization ?? ''))?.[1];
    const token: string | undefined = req.cookies?.[COOKIE.access] ?? bearer;
    req.authViaCookie = !!req.cookies?.[COOKIE.access];

    if (!token) {
      if (isPublic) return true;
      throw new AppError('UNAUTHENTICATED', 401, 'Authentication required.');
    }

    let sub: string;
    try {
      ({ sub } = await this.jwt.verifyAsync<{ sub: string }>(token, { secret: this.config.JWT_ACCESS_SECRET }));
    } catch (e) {
      if (isPublic) return true;
      const expired = (e as Error).name === 'TokenExpiredError';
      throw new AppError(expired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN', 401, expired ? 'Access token expired.' : 'Invalid access token.');
    }

    const ctx = await this.ctxService.get(sub);
    if (!ctx || ctx.status !== 'ACTIVE') {
      if (isPublic) return true;
      throw new AppError('ACCOUNT_SUSPENDED', 403, 'This account is not active.');
    }

    const user: AuthUser = { id: ctx.id, email: ctx.email, roles: ctx.roles, studentId: ctx.studentId, mentorId: ctx.mentorId };
    req.user = user;
    req.userPermissions = ctx.permissions;
    req.mfaEnabled = ctx.mfaEnabled;
    return true;
  }
}

/** Double-submit CSRF: cookie-authenticated state-changing requests must echo the csrf cookie in a header. */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, [context.getHandler(), context.getClass()])) return true;

    const usesCookies = req.cookies?.[COOKIE.access] || req.cookies?.[COOKIE.refresh];
    if (!usesCookies) return true; // bearer-token clients are not CSRF-able

    const cookie = String(req.cookies?.[COOKIE.csrf] ?? '');
    const header = String(req.headers['x-csrf-token'] ?? '');
    const a = Buffer.from(cookie);
    const b = Buffer.from(header);
    if (!cookie || a.length !== b.length || !timingSafeEqual(a, b)) {
      throw forbidden('CSRF token missing or invalid.');
    }
    return true;
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, @Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    if (!required?.length) return true;
    const req = context.switchToHttp().getRequest();
    const perms: Set<string> | undefined = req.userPermissions;
    if (!perms || !required.every((p) => perms.has(p))) throw forbidden();

    // Admin-panel accounts must have enrolled a second factor before any privileged action.
    const user: AuthUser | undefined = req.user;
    if (this.config.TWO_FACTOR_ENABLED === 'true' && user && isAdminRole(user.roles) && !req.mfaEnabled) {
      throw new AppError('MFA_REQUIRED', 403, 'Set up two-factor authentication to use admin features.');
    }
    return true;
  }
}
