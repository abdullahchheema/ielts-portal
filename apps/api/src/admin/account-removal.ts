import { Prisma } from '@ielts/db';
import { AuditService } from '../audit/audit.service';
import { AppError, notFound } from '../common/app-error';
import { Actor } from '../courses/courses.service';

export interface RemovalRequest {
  targetUserId: string;
  actor: Actor;
  actorEmail: string;
  ownerEmail: string | undefined;
  mustBeTeacher: boolean;
}

/**
 * Removes an account from use: signs it out, strips its roles, detaches it from batches and marks a teacher profile
 * REMOVED. Rows are kept, not deleted, so payments, grades and the audit trail still resolve.
 */
export async function removeAccount(tx: Prisma.TransactionClient, audit: AuditService, req: RemovalRequest) {
  const owner = req.ownerEmail?.toLowerCase();
  const user = await tx.user.findFirst({
    where: { id: req.targetUserId, deletedAt: null },
    include: { roles: { include: { role: true } }, mentor: true },
  });
  if (!user) throw notFound('User');
  const roles = user.roles.map((r) => r.role.name);

  if (req.mustBeTeacher && !user.mentor) throw notFound('Teacher');
  if (req.targetUserId === req.actor.userId) throw new AppError('FORBIDDEN', 403, 'You cannot remove your own account.');
  if (owner && user.email.toLowerCase() === owner) throw new AppError('FORBIDDEN', 403, 'The owner account cannot be removed.');
  if (roles.includes('SUPER_ADMIN') && req.actorEmail.toLowerCase() !== owner) {
    throw new AppError('FORBIDDEN', 403, 'Only the owner can remove a Super Admin.');
  }
  if (user.status === 'DEACTIVATED') throw new AppError('CONFLICT', 409, 'This account has already been removed.');

  await tx.user.update({ where: { id: user.id }, data: { status: 'DEACTIVATED' } });
  await tx.userRole.deleteMany({ where: { userId: user.id } });
  await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });

  let batchesLeft = 0;
  if (user.mentor) {
    batchesLeft = (await tx.batchMentor.deleteMany({ where: { mentorId: user.mentor.id } })).count;
    await tx.mentorProfile.update({ where: { id: user.mentor.id }, data: { status: 'REMOVED' } });
  }

  await audit.record({
    ...req.actor,
    action: 'ADMIN_REMOVED_ACCOUNT',
    entityType: 'User',
    entityId: user.id,
    before: { email: user.email, status: user.status, roles },
    after: { status: 'DEACTIVATED', roles: [], batchAssignmentsRemoved: batchesLeft },
  }, tx);
  return { id: user.id, status: 'DEACTIVATED' as const };
}
