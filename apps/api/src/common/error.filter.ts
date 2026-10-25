import { redact } from './redact';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '@ielts/db';
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
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // Log with the Prisma code so it's diagnosable without inferring from a generic 500.
      this.logger.error(redact({ prismaCode: exception.code, meta: exception.meta, request_id }), 'Prisma error');
      if (exception.code === 'P2002') {
        // Unique constraint — shouldn't normally reach here (services should catch P2002 themselves),
        // but if one slips through give a 409 rather than 500.
        status = 409;
        body = { code: 'CONFLICT', message: 'This operation conflicts with existing data.' };
      } else if (exception.code === 'P2028') {
        // Transaction timeout — surface as a retriable 503 rather than a cryptic 500.
        status = 503;
        body = { code: 'TRANSACTION_TIMEOUT', message: 'The request timed out. Please try again.' };
      }
      // All other Prisma codes stay as INTERNAL_ERROR / 500 (e.g. P2025 not-found should have
      // been caught by the service and converted to notFound(); if it wasn't, 500 is correct).
    } else {
      this.logger.error(redact({ err: exception, request_id }), 'Unhandled exception');
    }

    res.status(status).json({ error: { ...body, request_id } });
  }
}
