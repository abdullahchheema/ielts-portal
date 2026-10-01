import { Inject, Injectable, Logger } from '@nestjs/common';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { AppError } from '../common/app-error';
import { APP_CONFIG, AppConfig } from '../config/config.module';

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9/_\-.]{0,300}$/;

/** Files are always private. Reads go through short-lived signed URLs. */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3?: S3Client;
  private readonly bucket?: string;
  private readonly localRoot = resolve(existsSync(resolve(process.cwd(), '../../turbo.json')) ? resolve(process.cwd(), '../..') : process.cwd(), '.storage'); // repo root, shared with the demo seed

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    if (config.S3_BUCKET && config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY) {
      this.bucket = config.S3_BUCKET;
      this.s3 = new S3Client({
        region: config.S3_REGION,
        endpoint: config.S3_ENDPOINT,
        forcePathStyle: true,
        credentials: { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY },
      });
    } else {
      this.logger.warn('S3_* not configured — storing files in a private local folder (dev only).');
    }
  }

  private assertKey(key: string) {
    if (!KEY_RE.test(key) || key.includes('..')) throw new AppError('UPLOAD_FAILED', 400, 'Invalid file key.');
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.assertKey(key);
    try {
      if (this.s3) {
        await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
      } else {
        const path = this.localPath(key);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, body);
      }
    } catch (e) {
      this.logger.error(`Upload failed for ${key}: ${(e as Error).message}`);
      throw new AppError('UPLOAD_FAILED', 503, 'Could not store the file. Please try again.');
    }
  }

  async signedUrl(key: string, ttlSec = 300): Promise<string> {
    this.assertKey(key);
    if (this.s3) {
      return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: ttlSec });
    }
    const exp = Math.floor(Date.now() / 1000) + ttlSec;
    const sig = this.sign(key, exp);
    // Relative path (no origin): the browser reaches the API through the Next.js same-origin `/api/*` proxy
    // (apps/web/src/app/api/[...path]/route.ts). An absolute URL built from API_URL would default to
    // http://localhost:4000 in production (the single-project Vercel deploy has no separate API host), which
    // the browser cannot reach — so this must stay relative to resolve correctly in every environment.
    return `/api/files/local?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sig}`;
  }

  // ── local-fallback support (used by FilesController) ──
  private sign(key: string, exp: number) {
    return createHmac('sha256', this.config.JWT_ACCESS_SECRET).update(`${key}:${exp}`).digest('hex');
  }

  verifyLocal(key: string, exp: number, sig: string): boolean {
    if (this.s3 || !KEY_RE.test(key) || key.includes('..') || !Number.isFinite(exp) || exp < Date.now() / 1000) return false;
    const a = Buffer.from(this.sign(key, exp));
    const b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  readLocal(key: string) {
    return readFile(this.localPath(key));
  }

  private localPath(key: string) {
    const p = resolve(this.localRoot, key);
    if (!p.startsWith(this.localRoot + sep)) throw new AppError('UPLOAD_FAILED', 400, 'Invalid file key.');
    return p;
  }
}

// ── content sniffing: never trust the client-declared MIME type or filename ──
export type SniffedType = { mime: string; ext: string };

export function sniffFileType(buf: Buffer): SniffedType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  // Browser recordings (MediaRecorder) and common audio: WebM/Matroska, Ogg, MP4/M4A, WAV
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { mime: 'audio/webm', ext: 'webm' };
  if (buf.length >= 4 && buf.subarray(0, 4).toString('ascii') === 'OggS') return { mime: 'audio/ogg', ext: 'ogg' };
  if (buf.length >= 12 && buf.subarray(4, 8).toString('ascii') === 'ftyp') return { mime: 'audio/mp4', ext: 'm4a' };
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WAVE') return { mime: 'audio/wav', ext: 'wav' };
  // MP3: ID3 tag, or an MPEG audio frame sync (0xFFEx / 0xFFFx)
  if (buf.length >= 3 && buf.subarray(0, 3).toString('ascii') === 'ID3') return { mime: 'audio/mpeg', ext: 'mp3' };
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return { mime: 'audio/mpeg', ext: 'mp3' };
  return null;
}
