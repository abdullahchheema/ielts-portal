import { Prisma } from '@ielts/db';
import { AppError } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * The academy sells exactly one course ("Complete IELTS Preparation"). A database index guarantees at most one
 * live course, so this simply returns it together with its newest published version.
 */
export async function findMainCourse(db: Db) {
  const course = await db.course.findFirst({
    where: { deletedAt: null, status: { not: 'ARCHIVED' } },
    include: { versions: { where: { status: 'PUBLISHED' }, orderBy: { versionNumber: 'desc' }, take: 1 } },
  });
  return course ? { course, version: course.versions[0] ?? null } : null;
}

/** Same, but throws a readable error when the academy has not been set up yet. */
export async function getMainCourse(db: Db) {
  const found = await findMainCourse(db);
  if (!found) throw new AppError('COURSE_NOT_AVAILABLE', 404, 'The course has not been set up yet.');
  return found;
}
