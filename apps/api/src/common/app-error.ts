import { ErrorCode } from '@ielts/types';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly httpStatus: number,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Resource') => new AppError('NOT_FOUND', 404, `${what} not found.`);
export const forbidden = (msg = 'You do not have permission to do that.') => new AppError('FORBIDDEN', 403, msg);
export const conflict = (code: ErrorCode, msg: string) => new AppError(code, 409, msg);
