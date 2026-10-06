import { redact } from './redact';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from './app-error';

/** Produces the spec §53 error shape and never leaks internals. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request & { id?: string }>();
    const request_id = req.id ?? String(req.headers['x-request-id'] ?? '');

    let status = 500;
    let body: Record<string, unknown> = { code: 'INTERNAL_ERROR', message: 'Something went wrong.' };

    if (exception instanceof AppError) {
      status = exception.httpStatus;
      body = { code: exception.code, message: exception.message, ...(exception.details ? { details: exception.details } : {}) };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const map: Record<number, string> = {
        401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 413: 'FILE_TOO_LARGE', 429: 'RATE_LIMITED',
      };
      body = { code: map[status] ?? (status < 500 ? 'BAD_REQUEST' : 'INTERNAL_ERROR'), message: status < 500 ? exception.message : 'Something went wrong.' };
    } else {
      this.logger.error(redact({ err: exception, request_id }), 'Unhandled exception');
    }

    res.status(status).json({ error: { ...body, request_id } });
  }
}
