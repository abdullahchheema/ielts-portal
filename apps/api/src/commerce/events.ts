/**
 * Commerce events. Kept in their own file so feature modules (referrals, lifecycle) can listen for them
 * without importing the commerce service and creating an import cycle.
 */
export const ENROLLMENT_ACTIVATED = 'enrollment.activated';

export interface EnrollmentActivatedEvent {
  enrollmentId: string;
  studentId: string;
  userId: string;
  orderId?: string;
  source: string;
}
