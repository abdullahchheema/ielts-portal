import type { Metadata } from 'next';
import { LegalLayout } from '@/components/public/legal-layout';

export const metadata: Metadata = { title: 'Terms of Service — Connect IELTS Academy' };

const UPDATED = 'October 2026';

export default function TermsPage() {
  return (
    <LegalLayout eyebrow="Legal" title="Terms of Service" updated={UPDATED}>
      <p>
        These Terms of Service ("Terms") govern your use of the Connect IELTS Academy website and student portal
        (the "Service"), operated by <strong>[PLACEHOLDER: legal entity name]</strong> ("we", "us", "our"). By
        registering for an account, enrolling in a batch, or otherwise using the Service, you agree to these Terms.
      </p>

      <h2>1. The course</h2>
      <p>
        Connect IELTS Academy sells one course — the Complete IELTS Preparation course — delivered across live,
        teacher-led batches. Every batch teaches the same course content; batches differ only in start date, class
        timing, and assigned teacher. Batches have no enrollment capacity limit.
      </p>

      <h2>2. Accounts and eligibility</h2>
      <ul>
        <li>You must create an account and verify your email address to apply for a batch.</li>
        <li>You are responsible for keeping your login credentials confidential and for all activity under your account.</li>
        <li>You must provide accurate information when registering, including during the onboarding survey.</li>
      </ul>

      <h2>3. Enrollment and payment</h2>
      <p>
        Course fees are payable by bank transfer, JazzCash, or Easypaisa (or another method arranged directly with
        us). Enrollment is a one-time payment covering the full course and your access window — there is no
        recurring subscription charge.
      </p>
      <p>
        After you submit payment, you upload proof of payment (a receipt or transaction screenshot) with your
        application. A member of our team manually reviews and verifies every payment proof, typically within one
        working day. Your account and student portal access are activated once your payment is verified. If your
        proof is not accepted, you will see the reason in your application and may upload a corrected proof at no
        additional cost.
      </p>

      <h2>4. Refunds</h2>
      <p>
        Refund requests are reviewed on a case-by-case basis. <strong>[PLACEHOLDER: describe the academy's refund
        policy — e.g. eligibility window, how to request one, and how long processing takes]</strong>.
      </p>

      <h2>5. Classes, practice, and AI-assisted feedback</h2>
      <p>
        Classes are taught live by assigned teachers on a fixed weekly timetable. The portal additionally provides
        mock tests, graded practice, and progress tracking across all four modules (Listening, Reading, Writing,
        Speaking). Some feedback — for example, an estimated band on written or spoken responses — may be generated
        with the assistance of AI tools alongside teacher review. AI-estimated bands are indicative only and are not
        official IELTS scores.
      </p>
      <p>
        Speaking practice sessions may be recorded so that you and your teacher can review them. Recordings are used
        only for your own learning and teacher feedback, consistent with our Privacy Policy.
      </p>

      <h2>6. Teacher applications</h2>
      <p>
        If you apply to teach with us, you agree to provide accurate information and supporting documents. Submitting
        an application does not guarantee acceptance; we review every application and respond by email.
      </p>

      <h2>7. Certificates</h2>
      <p>
        Certificates of completion, where issued, can be verified through the public certificate-verification tool
        using the certificate code. We may revoke a certificate that was issued in error or obtained through false
        information.
      </p>

      <h2>8. Acceptable use</h2>
      <ul>
        <li>Do not share your account credentials or portal access with anyone else.</li>
        <li>Do not redistribute course materials, recordings, or practice content outside the Service.</li>
        <li>Do not attempt to interfere with, disrupt, or gain unauthorized access to the Service.</li>
      </ul>

      <h2>9. Changes to the course or these Terms</h2>
      <p>
        We may update course content, features, or these Terms from time to time. Material changes will be reflected
        by updating the "Last updated" date above; continued use of the Service after a change constitutes
        acceptance of the updated Terms.
      </p>

      <h2>10. Contact</h2>
      <p>
        Questions about these Terms can be sent to <strong>[PLACEHOLDER: support email]</strong> or via WhatsApp
        support.
      </p>

      <h2>11. Governing law</h2>
      <p>
        These Terms are governed by the laws of <strong>[PLACEHOLDER: governing jurisdiction]</strong>, without
        regard to its conflict-of-law principles.
      </p>
    </LegalLayout>
  );
}
