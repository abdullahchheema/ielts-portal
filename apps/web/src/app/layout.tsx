import type { Metadata } from 'next';
import { ReactNode } from 'react';
import { Providers } from '@/components/Providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'IELTS Academy', template: '%s · IELTS Academy' },
  description: 'Complete IELTS Preparation: live teacher-led batches, daily mock tests and graded practice.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 font-sans text-slate-900 antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
