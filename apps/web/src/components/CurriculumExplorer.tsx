'use client';

import { BookOpen, Headphones, Mic, PenLine, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Tabs } from '@/components/ui';

type TestType = 'ACADEMIC' | 'GENERAL';

interface ModuleOutline {
  key: string;
  name: string;
  icon: LucideIcon;
  shared: boolean;
  points: Record<TestType, string[]> | { both: string[] };
}

const MODULES: ModuleOutline[] = [
  {
    key: 'listening', name: 'Listening', icon: Headphones, shared: true,
    points: { both: ['Four recorded sections, played once, under real exam timing', 'Every question type: notes, forms, tables, maps, multiple choice', 'Weekly drills on the sections students miss most'] },
  },
  {
    key: 'reading', name: 'Reading', icon: BookOpen, shared: false,
    points: {
      ACADEMIC: ['Three long passages from academic/journal-style sources', 'True/False/Not Given, matching headings, summary completion', 'Timed practice against the real 60-minute pressure'],
      GENERAL: ['Three sections: everyday notices, workplace text, a longer general-interest passage', 'Same question types as Academic, applied to everyday material', 'Skimming and scanning drills for speed'],
    },
  },
  {
    key: 'writing', name: 'Writing', icon: PenLine, shared: false,
    points: {
      ACADEMIC: ['Task 1: describe a graph, chart, table or diagram', 'Task 2: a 250-word argumentative essay', 'Every essay graded by your teacher against the real band descriptors, with an AI estimate alongside'],
      GENERAL: ['Task 1: a formal, semi-formal or informal letter', 'Task 2: the same essay format as Academic', 'Every letter and essay graded by your teacher, with an AI estimate alongside'],
    },
  },
  {
    key: 'speaking', name: 'Speaking', icon: Mic, shared: true,
    points: { both: ['Parts 1, 2 and 3, recorded so you can hear yourself back', 'Timed Part 2 cue-card practice every week', 'Personal feedback on fluency, pacing and pronunciation from your teacher'] },
  },
];

const TOGGLE = [{ key: 'ACADEMIC', label: 'Academic' }, { key: 'GENERAL', label: 'General Training' }];

/** Toggles the Reading/Writing content between Academic and General Training; Listening/Speaking are identical either way. */
export function CurriculumExplorer() {
  const [testType, setTestType] = useState<TestType>('ACADEMIC');

  return (
    <div>
      <div className="flex justify-center">
        <Tabs aria-label="Test type" variant="segment" value={testType} onChange={(k) => setTestType(k as TestType)} items={TOGGLE} />
      </div>
      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        {MODULES.map((m) => {
          const items = 'both' in m.points ? m.points.both : m.points[testType];
          return (
            <div key={m.key} className="rounded-2xl bg-surface p-7 shadow-sm ring-1 ring-border">
              <div className="flex items-center gap-3">
                <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-fg">
                  <m.icon className="size-5" strokeWidth={1.75} />
                </span>
                <div>
                  <h3 className="text-base font-bold text-fg">{m.name}</h3>
                  {!m.shared && <p className="text-xs font-semibold text-fg-subtle">{testType === 'ACADEMIC' ? 'Academic' : 'General Training'} format</p>}
                </div>
              </div>
              <ul className="mt-4 space-y-2.5">
                {items.map((p) => (
                  <li key={p} className="flex items-start gap-2.5 text-sm leading-relaxed text-fg-muted">
                    <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
