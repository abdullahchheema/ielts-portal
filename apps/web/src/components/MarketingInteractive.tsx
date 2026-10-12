'use client';

import { BookOpen, Headphones, Mic, PenLine, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Accordion, Tabs } from '@/components/ui';

interface ModuleTab {
  key: string;
  name: string;
  icon: LucideIcon;
  blurb: string;
  points: string[];
}

const MODULE_TABS: ModuleTab[] = [
  { key: 'listening', name: 'Listening', icon: Headphones, blurb: 'Four recordings, under real exam timing, with every question type the test uses.',
    points: ['Note, form and table completion', 'Multiple choice and matching', 'Maps, plans and diagrams'] },
  { key: 'reading', name: 'Reading', icon: BookOpen, blurb: 'Three passages worked the way examiners actually set them, not simplified.',
    points: ['True / False / Not Given', 'Matching headings and features', 'Summary and sentence completion'] },
  { key: 'writing', name: 'Writing', icon: PenLine, blurb: 'Task 1 and Task 2 essays graded by your teacher against the real band descriptors.',
    points: ['Criteria-based written feedback', 'An AI estimated band alongside it', 'Your revision history, side by side'] },
  { key: 'speaking', name: 'Speaking', icon: Mic, blurb: 'Parts 1, 2 and 3, recorded and reviewed, so you hear yourself the way an examiner would.',
    points: ['Timed Part 2 cue cards', 'Personal feedback from your teacher', 'Fluency and pacing indicators'] },
];

/** The four-module tabbed showcase. One active tab at a time; the panel below swaps with it. */
export function FeatureShowcase() {
  const [active, setActive] = useState(MODULE_TABS[0].key);
  const tab = MODULE_TABS.find((t) => t.key === active) ?? MODULE_TABS[0];

  return (
    <div>
      <div className="flex justify-center">
        <Tabs aria-label="Course modules" variant="segment" value={active} onChange={setActive} items={MODULE_TABS.map((t) => ({ key: t.key, label: t.name }))} />
      </div>
      <div className="mt-7 overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="grid gap-6 p-7 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] sm:p-10">
          <div>
            <span aria-hidden className="grid size-11 place-items-center rounded-lg bg-primary text-primary-fg shadow-xs">
              <tab.icon className="size-5" strokeWidth={1.75} />
            </span>
            <h3 className="mt-4 text-lg font-bold text-fg">{tab.name}</h3>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">{tab.blurb}</p>
          </div>
          <ul className="space-y-3 text-sm">
            {tab.points.map((p) => (
              <li key={p} className="flex items-start gap-3 rounded-lg bg-canvas px-4 py-3">
                <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />
                <span className="text-fg">{p}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** FAQ accordion built on the shared `Accordion` primitive — single-open, matching every other disclosure panel in the app. */
export function FaqAccordion({ items }: { items: { q: string; a: string }[] }) {
  return <Accordion items={items.map((f) => ({ key: f.q, title: f.q, content: f.a }))} defaultOpen={items[0]?.q} />;
}
