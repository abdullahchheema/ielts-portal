import { Controller, Get, Header, Inject, Injectable, Module, Param, StreamableFile } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib';
import { AppError, forbidden, notFound } from '../common/app-error';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { APP_CONFIG, AppConfig } from '../config/config.module';
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

@Injectable()
export class CertificatesService {
  constructor(private readonly prisma: PrismaService, @Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** Issues (once) the certificate for a completed enrollment. Idempotent. */
  async issue(studentId: string, enrollmentId: string) {
    const e = await this.prisma.enrollment.findFirst({
      where: { id: enrollmentId, studentId, deletedAt: null },
      include: { student: { select: { firstName: true, lastName: true } }, course: { select: { title: true } }, certificate: true },
    });
    if (!e) throw notFound('Enrollment');
    if (e.certificate) return e.certificate;
    if (e.status !== 'COMPLETED') throw new AppError('CONFLICT', 409, 'Certificates are issued once every required lesson is complete.');

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const cert = await this.prisma.certificate.create({ data: { enrollmentId, studentId, code: newCode(), studentName: `${e.student.firstName} ${e.student.lastName}`.trim(), courseTitle: e.course.title } });
        await this.prisma.studentTimelineEvent.create({ data: { studentId, type: 'CERTIFICATE_ISSUED', summary: `Certificate issued for ${e.course.title}`, meta: { certificateId: cert.id } } });
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
    const rows = await this.prisma.certificate.findMany({ where: { studentId }, orderBy: { issuedAt: 'desc' }, include: { enrollment: { select: { status: true } } } });
    return rows.map((c) => ({ id: c.id, code: c.code, courseTitle: c.courseTitle, issuedAt: c.issuedAt, valid: c.enrollment.status === 'COMPLETED' }));
  }

  /** Public verification: reveals only name, course and date, and reports invalid if the enrollment was refunded or cancelled since. */
  async verify(code: string) {
    const c = await this.prisma.certificate.findUnique({ where: { code: code.toUpperCase() }, include: { enrollment: { select: { status: true } } } });
    if (!c) return { valid: false as const };
    return { valid: c.enrollment.status === 'COMPLETED', studentName: c.studentName, courseTitle: c.courseTitle, issuedAt: c.issuedAt };
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
    while (bold.widthOfTextAtSize(safe(v.studentName!, bold), nameSize) > 700 && nameSize > 18) nameSize -= 2;
    center(v.studentName!, 355, nameSize, bold);
    page.drawLine({ start: { x: 221, y: 345 }, end: { x: 621, y: 345 }, thickness: 0.75, color: accent });
    center('has successfully completed all required lessons and assessments of', 305, 16, serif);
    let courseSize = 26;
    while (bold.widthOfTextAtSize(safe(v.courseTitle!, bold), courseSize) > 700 && courseSize > 14) courseSize -= 2;
    center(v.courseTitle!, 260, courseSize, bold);
    center(`Issued on ${v.issuedAt!.toISOString().slice(0, 10)}`, 200, 14, serif);
    center(`Certificate ID: ${code.toUpperCase()}`, 95, 11, sans, rgb(0.35, 0.35, 0.4));
    center(`Verify at ${this.config.APP_URL}/verify/${code.toUpperCase()}`, 78, 10, sans, rgb(0.35, 0.35, 0.4));
    return doc.save();
  }
}

@Controller()
export class CertificatesController {
  constructor(private readonly certs: CertificatesService) {}

  @Get('me/certificates')
  mine(@CurrentUser() u: AuthUser) {
    if (!u.studentId) throw forbidden('Only student accounts can do this.');
    return this.certs.list(u.studentId);
  }

  @Public() @Get('certificates/:code/verify')
  verify(@Param('code') code: string) { return this.certs.verify(code.slice(0, 40)); }

  @Public() @Get('certificates/:code/pdf')
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'attachment; filename="certificate.pdf"')
  @Header('Cache-Control', 'private, no-store')
  async pdf(@Param('code') code: string) { return new StreamableFile(await this.certs.pdf(code.slice(0, 40))); }
}

@Module({ controllers: [CertificatesController], providers: [CertificatesService], exports: [CertificatesService] })
export class CertificatesModule {}
