import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export interface AuthUser {
  id: string;
  email: string;
  roles: string[];
  studentId?: string;
  mentorId?: string;
}

export const IS_PUBLIC = 'isPublic';
export const PERMISSIONS_KEY = 'permissions';

export const Public = () => SetMetadata(IS_PUBLIC, true);
export const RequirePermission = (...keys: string[]) => SetMetadata(PERMISSIONS_KEY, keys);
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser =>
  ctx.switchToHttp().getRequest().user);

export function clientMeta(req: { ip?: string; headers: Record<string, unknown> }) {
  return { ip: req.ip, userAgent: String(req.headers['user-agent'] ?? '').slice(0, 255) };
}
