import { PipeTransform } from '@nestjs/common';
import { ZodType, ZodTypeDef } from 'zod';
import { AppError } from './app-error';

export class ZodPipe<T> implements PipeTransform<unknown, T> {
  // Input type is left open so schemas that transform (coerce, default, refine…) work too.
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    const details: Record<string, string> = {};
    for (const issue of result.error.issues) details[issue.path.join('.') || '_'] ??= issue.message;
    throw new AppError('VALIDATION_ERROR', 422, 'Some fields are invalid.', details);
  }
}
