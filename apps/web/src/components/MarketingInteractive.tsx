'use client';

import { BookOpen, Headphones, Mic, PenLine, type LucideIcon } from 'lucide-react';
import { useState } from 'react';

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
      <div role="tablist" aria-label="Course modules" className="flex flex-wrap justify-center gap-2.5">
        {MODULE_TABS.map((t) => (
          <button
            key={t.key} type="button" role="tab" aria-selected={t.key === active}
            className="mkt-tab" data-active={t.key === active} onClick={() => setActive(t.key)}
          >
            <t.icon aria-hidden className="size-4" strokeWidth={1.75} />
            {t.name}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="mkt-card mkt-card--hero mt-7 overflow-hidden">
        <div className="flex items-center gap-1.5 border-b border-[var(--mkt-border)] bg-[var(--mkt-canvas)] px-4 py-3">
          <span aria-hidden className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span aria-hidden className="size-2.5 rounded-full bg-[#febc2e]" />
          <span aria-hidden className="size-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-3 text-xs font-medium text-[var(--mkt-subtle)]">ielts academy · {tab.name} practice</span>
        </div>
        <div className="grid gap-6 p-7 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] sm:p-10">
          <div>
            <span aria-hidden className="grid size-11 place-items-center rounded-full text-white" style={{ background: 'var(--mkt-blue-grad)' }}>
              <tab.icon className="size-5" strokeWidth={1.75} />
            </span>
            <h3 className="mt-4 text-xl font-extrabold">{tab.name}</h3>
            <p className="mt-2 text-sm leading-relaxed">{tab.blurb}</p>
          </div>
          <ul className="space-y-3 text-sm">
            {tab.points.map((p) => (
              <li key={p} className="flex items-start gap-3 rounded-xl bg-[var(--mkt-canvas)] px-4 py-3">
                <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full" style={{ background: 'var(--mkt-blue)' }} />
                <span className="text-[var(--mkt-heading)]">{p}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** Single-open FAQ accordion: opening one row closes whichever was open, matching the reference's measured behavior. */
export function FaqAccordion({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState(0);
  return (
    <div className="space-y-3">
      {items.map((f, i) => {
        const isOpen = open === i;
        return (
          <div key={f.q} className="mkt-faq-row" data-open={isOpen}>
            <button
              type="button" onClick={() => setOpen(isOpen ? -1 : i)} aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left font-semibold text-[var(--mkt-heading)]"
            >
              {f.q}
              <ChevronDown />
            </button>
            {isOpen && <p className="px-5 pb-4 pr-10 text-sm leading-relaxed text-[var(--mkt-body)]">{f.a}</p>}
          </div>
        );
      })}
    </div>
  );
}

function ChevronDown() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="mkt-faq-chevron size-4.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
