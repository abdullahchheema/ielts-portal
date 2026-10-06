import { Body, Controller, Get, Header, HttpCode, Inject, Injectable, Module, Param, Post, Req, StreamableFile } from '@nestjs/common';
import type { Request } from 'express';
import { randomBytes } from 'node:crypto';
import * as QRCode from 'qrcode';
import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib';
import { z } from 'zod';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditService } from '../audit/audit.service';
import { LIFECYCLE_SIGNAL } from '../student-lifecycle/lifecycle.service';
import { AppError, forbidden, notFound, conflict } from '../common/app-error';
import { AuthUser, CurrentUser, Public, RequirePermission, clientMeta } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { APP_CONFIG, AppConfig } from '../config/config.module';
import { RateLimiter } from '../integrations/rate-limiter.service';
import { PrismaService } from '../prisma/prisma.service';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const newCode = () => {
  const b = randomBytes(12);
  const c = Array.from(b, (x) => ALPHABET[x % ALPHABET.length]).join('');
  return `IELTS-${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}`;
};

/** Standard PDF fonts only cover Latin text; anything else is replaced so a name can never crash generation. */
function safe(text: string, font: PDFFont): string {
  return Array.from(text).map((ch) => { try { font.encodeText(ch); return ch; } catch { return '?'; } }).join('');
}

/** Verification outcomes a public visitor can see. Nothing here reveals more than the outcome and the holder's name and course. */
export type VerifyResult =
  | { valid: false; status: 'NOT_FOUND' }
  | { valid: false; status: 'REVOKED'; certificateNumber: string | null }
  | { valid: false; status: 'NOT_VALID' }
  | { valid: true; status: 'ISSUED'; certificateNumber: string | null; studentName: string; courseTitle: string; batchName: string | null; issuedAt: Date };

@Injectable()
export class CertificatesService {
  constructor(private readonly prisma: PrismaService, @Inject(APP_CONFIG) private readonly config: AppConfig, private readonly audit: AuditService, private readonly events: EventEmitter2) {}

  /** A sequential number per year, for printed and quoted references. Unique in the database; retried on collision. */
  private async nextNumber(year: number): Promise<string> {
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year + 1, 0, 1));
    const n = await this.prisma.certificate.count({ where: { issuedAt: { gte: start, lt: end } } });
    return `IA-${year}-${String(n + 1).padStart(6, '0')}`;
  }

  /** Issues (once) the certificate for a completed enrollment. Idempotent. */
  async issue(studentId: string, enrollmentId: string) {
    const e = await this.prisma.enrollment.findFirst({
      where: { id: enrollmentId, studentId, deletedAt: null },
      include: { student: { select: { firstName: true, lastName: true } }, course: { select: { title: true } }, batch: { select: { name: true } }, certificate: true },
    });
    if (!e) throw notFound('Enrollment');
    if (e.certificate) return e.certificate;
    if (e.status !== 'COMPLETED') throw new AppError('CONFLICT', 409, 'Certificates are issued once every required lesson is complete.');

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const cert = await this.prisma.certificate.create({
          data: {
            enrollmentId, studentId, code: newCode(), certificateNumber: await this.nextNumber(new Date().getUTCFullYear()),
            studentName: `${e.student.firstName} ${e.student.lastName}`.trim(), courseTitle: e.course.title, batchName: e.batch.name,
          },
        });
        await this.prisma.studentTimelineEvent.create({ data: { studentId, type: 'CERTIFICATE_ISSUED', summary: `Certificate issued for ${e.course.title}`, meta: { certificateId: cert.id } } });
        // A student with a certificate is an alumnus. The lifecycle rules refuse this unless the course is complete.
        this.events.emit(LIFECYCLE_SIGNAL, { studentId, to: 'ALUMNI', reason: 'Certificate issued' });
        return cert;
      } catch (err) {
        if ((err as { code?: string }).code !== 'P2002') throw err;
        const existing = await this.prisma.certificate.findUnique({ where: { enrollmentId } });
        if (existing) return existing; // concurrent request issued it
      }
    }
    throw new AppError('INTERNAL_ERROR', 500, 'Could not issue the certificate. Please try again.');
  }

  /** The student's certificates; completed courses without one are issued on the spot. */
  async list(studentId: string) {
    const missing = await this.prisma.enrollment.findMany({ where: { studentId, status: 'COMPLETED', deletedAt: null, certificate: null }, select: { id: true } });
    for (const m of missing) await this.issue(studentId, m.id).catch(() => undefined);
    const rows = await this.prisma.certificate.findMany({
      where: { studentId }, orderBy: { issuedAt: 'desc' },
      include: { enrollment: { select: { status: true } }, revocation: { select: { id: true } } },
    });
    return rows.map((c) => ({
      id: c.id, code: c.code, certificateNumber: c.certificateNumber, courseTitle: c.courseTitle, batchName: c.batchName, issuedAt: c.issuedAt,
      valid: c.enrollment.status === 'COMPLETED' && !c.revocation,
      revoked: !!c.revocation,
    }));
  }

  /** Public verification: name, course, batch and date only, and a status that says whether it still stands. */
  async verify(code: string): Promise<VerifyResult> {
    const c = await this.prisma.certificate.findUnique({
      where: { code: code.toUpperCase() },
      include: { enrollment: { select: { status: true } }, revocation: { select: { id: true } } },
    });
    if (!c) return { valid: false, status: 'NOT_FOUND' };
    if (c.revocation) return { valid: false, status: 'REVOKED', certificateNumber: c.certificateNumber };
    if (c.enrollment.status !== 'COMPLETED') return { valid: false, status: 'NOT_VALID' };
    return { valid: true, status: 'ISSUED', certificateNumber: c.certificateNumber, studentName: c.studentName, courseTitle: c.courseTitle, batchName: c.batchName, issuedAt: c.issuedAt };
  }

  /** Revocation is recorded, never deleted, and the certificate stays in the database. */
  async revoke(id: string, reason: string, actorId: string, meta: { ip?: string; userAgent?: string }) {
    const c = await this.prisma.certificate.findUnique({ where: { id }, select: { id: true, revocation: { select: { id: true } } } });
    if (!c) throw notFound('Certificate');
    if (c.revocation) throw conflict('CONFLICT', 'This certificate is already revoked.');
    await this.prisma.$transaction(async (tx) => {
      await tx.certificateRevocation.create({ data: { certificateId: id, reason, revokedById: actorId } });
      await this.audit.record({ userId: actorId, ...meta, action: 'ADMIN_REVOKED_CERTIFICATE', entityType: 'Certificate', entityId: id, before: { status: 'ISSUED' }, after: { status: 'REVOKED', reason } }, tx);
    });
    return { id, status: 'REVOKED' };
  }

  async pdf(code: string): Promise<Uint8Array> {
    const v = await this.verify(code);
    if (!v.valid) throw notFound('Certificate');

    const doc = await PDFDocument.create();
    const page = doc.addPage([842, 595]); // A4 landscape
    const serif = await doc.embedFont(StandardFonts.TimesRoman);
    const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
    const sans = await doc.embedFont(StandardFonts.Helvetica);
    const ink = rgb(0.1, 0.1, 0.2);
    const accent = rgb(0.31, 0.27, 0.9);
    const center = (text: string, y: number, size: number, font: PDFFont, color = ink) => {
      const t = safe(text, font);
      page.drawText(t, { x: (842 - font.widthOfTextAtSize(t, size)) / 2, y, size, font, color });
    };

    page.drawRectangle({ x: 24, y: 24, width: 794, height: 547, borderColor: accent, borderWidth: 3 });
    page.drawRectangle({ x: 34, y: 34, width: 774, height: 527, borderColor: accent, borderWidth: 0.75 });
    center('CERTIFICATE OF COMPLETION', 470, 34, bold, accent);
    center('This is to certify that', 415, 16, serif);
    let nameSize = 40;
    while (bold.widthOfTextAtSize(safe(v.studentName, bold), nameSize) > 700 && nameSize > 18) nameSize -= 2;
    center(v.studentName, 355, nameSize, bold);
    page.drawLine({ start: { x: 221, y: 345 }, end: { x: 621, y: 345 }, thickness: 0.75, color: accent });
    center('has successfully completed all required lessons and assessments of', 305, 16, serif);
    let courseSize = 26;
    while (bold.widthOfTextAtSize(safe(v.courseTitle, bold), courseSize) > 700 && courseSize > 14) courseSize -= 2;
    center(v.courseTitle, 260, courseSize, bold);
    center(`Issued on ${v.issuedAt.toISOString().slice(0, 10)}`, 200, 14, serif);
    center(`Certificate ID: ${code.toUpperCase()}${v.certificateNumber ? ` · No. ${v.certificateNumber}` : ''}`, 95, 11, sans, rgb(0.35, 0.35, 0.4));
    const verifyUrl = `${this.config.APP_URL}/verify/${code.toUpperCase()}`;
    center(`Verify at ${verifyUrl}`, 78, 10, sans, rgb(0.35, 0.35, 0.4));
    // The QR code points at the public verification page only. It carries no personal data.
    const qr = await QRCode.toBuffer(verifyUrl, { type: 'png', margin: 1, width: 180 });
    const qrImage = await doc.embedPng(qr);
    page.drawImage(qrImage, { x: 680, y: 60, width: 110, height: 110 });
    return doc.save();
  }
}

const revokeSchema = z.object({ reason: z.string().trim().min(5).max(500) });
const verifyLimit = 60; // public checks per IP per hour

@Controller()
export class CertificatesController {
  constructor(private readonly certs: CertificatesService, private readonly limiter: RateLimiter) {}

  @Get('me/certificates')
  mine(@CurrentUser() u: AuthUser) {
    if (!u.studentId) throw forbidden('Only student accounts can do this.');
    return this.certs.list(u.studentId);
  }

  @Public() @Get('certificates/:code/verify')
  async verify(@Param('code') code: string, @Req() req: Request) {
    const ip = clientMeta(req).ip ?? 'unknown';
    if (!(await this.limiter.hit(`cert-verify:${ip}`, verifyLimit, 3600)).allowed) {
      throw new AppError('RATE_LIMITED', 429, 'Too many checks from this connection. Please try again later.');
    }
    return this.certs.verify(code.slice(0, 40));
  }

  @Public() @Get('certificates/:code/pdf')
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'attachment; filename="certificate.pdf"')
  @Header('Cache-Control', 'private, no-store')
  async pdf(@Param('code') code: string) { return new StreamableFile(await this.certs.pdf(code.slice(0, 40))); }

  @RequirePermission('certificate.revoke') @HttpCode(200) @Post('admin/certificates/:id/revoke')
  revoke(@Param('id') id: string, @Body(new ZodPipe(revokeSchema)) body: { reason: string }, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.certs.revoke(id, body.reason, u.id, clientMeta(req));
  }
}

@Module({ controllers: [CertificatesController], providers: [CertificatesService], exports: [CertificatesService] })
export class CertificatesModule {}
