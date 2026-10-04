import type { Metadata } from 'next';
import { Inter, Plus_Jakarta_Sans } from 'next/font/google';
import { ReactNode } from 'react';
import { Providers } from '@/components/Providers';
import './globals.css';

// Font variables go on <html>: preflight resolves --font-sans onto html at build time.
const body = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-body' });
const display = Plus_Jakarta_Sans({ subsets: ['latin'], display: 'swap', variable: '--font-display-face' });

export const metadata: Metadata = {
  title: { default: 'IELTS Academy', template: '%s · IELTS Academy' },
  description: 'Complete IELTS Preparation: live teacher-led batches, daily mock tests and graded practice.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable}`}>
      <body className="bg-canvas text-fg antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
