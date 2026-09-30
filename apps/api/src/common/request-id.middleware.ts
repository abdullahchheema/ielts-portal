import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export function requestId(req: Request & { id?: string }, res: Response, next: NextFunction) {
  req.id = `req_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  res.setHeader('x-request-id', req.id);
  next();
}
