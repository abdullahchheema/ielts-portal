import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { ReactNode } from 'react';
import { MotionProvider } from '@/components/motion/provider';
import { Providers } from '@/components/Providers';
import './globals.css';

// One typeface, system-wide: Plus Jakarta Sans backs both the body and display
// font variables. It's loaded as a variable font (no `weight` array), so the
// full 200-800 range is available without a second font download.
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], display: 'swap', variable: '--font-body' });

export const metadata: Metadata = {
  title: { default: 'Connect IELTS Academy', template: '%s · Connect IELTS Academy' },
  description: 'Complete IELTS Preparation: live teacher-led batches, daily mock tests and graded practice.',
  icons: { icon: '/brand/mark.png', apple: '/brand/mark.png' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body className="bg-canvas text-fg antialiased">
        <MotionProvider>
          <Providers>{children}</Providers>
        </MotionProvider>
      </body>
    </html>
  );
}
