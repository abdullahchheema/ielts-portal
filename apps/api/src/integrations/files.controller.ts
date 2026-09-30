import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AppError } from '../common/app-error';
import { Public } from '../common/decorators';
import { StorageService } from './storage.service';

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf', mp3: 'audio/mpeg', webm: 'audio/webm', ogg: 'audio/ogg', m4a: 'audio/mp4', wav: 'audio/wav',
};

/** Serves the local-folder fallback via HMAC-signed, expiring URLs. Unused when S3 is configured. */
@Controller('files')
export class FilesController {
  constructor(private readonly storage: StorageService) {}

  @Public() @Get('local')
  async local(@Query('key') key = '', @Query('exp') exp = '', @Query('sig') sig = '', @Res() res: Response) {
    if (!this.storage.verifyLocal(key, Number(exp), sig)) throw new AppError('ACCESS_DENIED', 403, 'This link is invalid or has expired.');
    let body: Buffer;
    try {
      body = await this.storage.readLocal(key);
    } catch {
      throw new AppError('FILE_UNAVAILABLE', 404, 'File not found.');
    }
    const ext = key.split('.').pop()?.toLowerCase() ?? '';
    res.setHeader('Content-Type', MIME_BY_EXT[ext] ?? 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'inline');
    res.send(body);
  }
}
