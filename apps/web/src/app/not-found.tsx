import Link from 'next/link';
import { Compass } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <span aria-hidden className="grid size-12 place-items-center rounded-full bg-primary-soft text-primary"><Compass className="size-6" /></span>
      <div>
        <p className="font-display text-xl font-semibold text-fg">Page not found</p>
        <p className="mt-1 max-w-sm text-sm text-fg-muted">The page you're looking for doesn't exist, or may have moved.</p>
      </div>
      <Link href="/" className="text-sm font-semibold text-primary hover:text-primary-hover">Back to the homepage</Link>
    </div>
  );
}
