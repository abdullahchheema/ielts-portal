'use client';

import { BarChart3, Flame, Mic, PenLine, ArrowUpRight, CheckCircle2, Clock3, Play } from 'lucide-react';
import { useState } from 'react';
import { Tabs } from '@/components/ui';

type PanelKey = 'dashboard' | 'mockTest' | 'writing' | 'speaking';

const TABS: { key: PanelKey; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'mockTest', label: 'Mock tests' },
  { key: 'writing', label: 'Writing feedback' },
  { key: 'speaking', label: 'Speaking practice' },
];

/** Illustrative mockups of the real student portal screens — not live data, a preview of the shape of the product. */
export function PortalPreview() {
  const [active, setActive] = useState<PanelKey>('dashboard');

  return (
    <div>
      <div className="flex justify-center">
        <Tabs aria-label="Portal preview" variant="segment" value={active} onChange={(k) => setActive(k as PanelKey)} items={TABS} />
      </div>
      <div className="mt-8 overflow-hidden rounded-3xl border border-border bg-ink p-4 shadow-xl sm:p-8">
        <div className="overflow-hidden rounded-2xl bg-canvas shadow-inner">
          {active === 'dashboard' && <DashboardPanel />}
          {active === 'mockTest' && <MockTestPanel />}
          {active === 'writing' && <WritingPanel />}
          {active === 'speaking' && <SpeakingPanel />}
        </div>
      </div>
    </div>
  );
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 border-b border-border bg-surface px-5 py-3.5">
        <span className="size-2.5 rounded-full bg-danger/40" />
        <span className="size-2.5 rounded-full bg-warning/40" />
        <span className="size-2.5 rounded-full bg-success/40" />
        <span className="ml-3 text-xs font-semibold text-fg-subtle">{title}</span>
      </div>
      <div className="p-5 sm:p-7">{children}</div>
    </div>
  );
}

function DashboardPanel() {
  return (
    <Frame title="app.connectielts.academy/student">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-surface p-5 shadow-sm ring-1 ring-border sm:col-span-2">
          <p className="text-xs font-semibold text-fg-subtle">Estimated overall band</p>
          <div className="mt-2 flex items-end gap-3">
            <span className="font-display text-4xl font-extrabold text-primary">7.0</span>
            <span className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-success-soft px-2.5 py-1 text-xs font-bold text-success"><ArrowUpRight className="size-3.5" /> +0.5 this month</span>
          </div>
          <div className="mt-5 grid grid-cols-4 gap-3 text-center">
            {[['Writing', '6.5'], ['Speaking', '7.0'], ['Reading', '7.5'], ['Listening', '7.5']].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-canvas p-3 ring-1 ring-border">
                <p className="text-[11px] font-semibold text-fg-subtle">{k}</p>
                <p className="mt-1 text-lg font-bold text-fg">{v}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl bg-surface p-5 shadow-sm ring-1 ring-border">
          <div className="flex items-center gap-2">
            <Flame className="size-4.5 text-accent-strong" strokeWidth={1.75} />
            <p className="text-xs font-semibold text-fg-subtle">Study streak</p>
          </div>
          <p className="mt-2 font-display text-3xl font-extrabold text-fg">12 days</p>
          <p className="mt-1 text-xs text-fg-subtle">Next class: Mon 18:00</p>
        </div>
      </div>
      <div className="mt-4 rounded-2xl bg-surface p-5 shadow-sm ring-1 ring-border">
        <p className="text-xs font-semibold text-fg-subtle">This week's study plan</p>
        <ul className="mt-3 space-y-2.5">
          {['Writing Task 2 — practice essay', 'Listening Section 3 drill', 'Speaking Part 2 recording'].map((t) => (
            <li key={t} className="flex items-center gap-2.5 text-sm text-fg"><CheckCircle2 className="size-4 shrink-0 text-accent-strong" strokeWidth={2} />{t}</li>
          ))}
        </ul>
      </div>
    </Frame>
  );
}

function MockTestPanel() {
  return (
    <Frame title="app.connectielts.academy/student/mock-tests">
      <div className="flex items-center justify-between">
        <p className="text-base font-bold text-fg">Full mock tests</p>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-xs font-bold text-primary"><Clock3 className="size-3.5" />2h 45m, timed</span>
      </div>
      <div className="mt-4 space-y-3">
        {[
          { name: 'Mock Test 4 — Full exam', band: '7.0', date: '2 days ago' },
          { name: 'Mock Test 3 — Full exam', band: '6.5', date: '1 week ago' },
          { name: 'Mock Test 2 — Full exam', band: '6.5', date: '2 weeks ago' },
        ].map((m) => (
          <div key={m.name} className="flex items-center justify-between rounded-xl bg-surface p-4 shadow-sm ring-1 ring-border">
            <div>
              <p className="text-sm font-bold text-fg">{m.name}</p>
              <p className="text-xs text-fg-subtle">{m.date}</p>
            </div>
            <span className="font-display text-xl font-extrabold text-primary">{m.band}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-xl bg-accent-soft p-4 text-sm font-semibold text-accent-strong">Take the next mock test to keep your readiness estimate current.</div>
    </Frame>
  );
}

function WritingPanel() {
  return (
    <Frame title="app.connectielts.academy/student/writing-ai">
      <div className="grid gap-5 sm:grid-cols-[1.3fr_1fr]">
        <div className="rounded-xl bg-surface p-5 text-sm leading-relaxed text-fg shadow-sm ring-1 ring-border">
          <p className="mb-2 flex items-center gap-2 text-xs font-bold text-fg-subtle"><PenLine className="size-4" />Task 2 — your submission</p>
          Some people believe universities should prepare students directly for the workplace, while others argue
          <span className="mx-1 rounded bg-warning-soft px-1 text-warning ring-1 ring-warning/30">this view overlooks</span>
          the broader purpose of higher education...
          <p className="mt-3 rounded-lg bg-canvas p-3 text-xs text-fg-muted">Teacher note: strong coherence, work on cohesive devices between paragraphs.</p>
        </div>
        <div className="space-y-3">
          {[['Task Achievement', 6.5], ['Coherence & Cohesion', 6.0], ['Lexical Resource', 7.0], ['Grammatical Range', 6.5]].map(([k, v]) => (
            <div key={k as string} className="rounded-xl bg-surface p-3.5 shadow-sm ring-1 ring-border">
              <div className="flex items-center justify-between text-xs font-semibold text-fg-subtle"><span>{k}</span><span className="font-bold text-fg">{v}</span></div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-canvas"><div className="h-full rounded-full bg-primary" style={{ width: `${(Number(v) / 9) * 100}%` }} /></div>
            </div>
          ))}
        </div>
      </div>
    </Frame>
  );
}

function SpeakingPanel() {
  return (
    <Frame title="app.connectielts.academy/student/speaking-ai">
      <div className="flex items-center gap-4 rounded-xl bg-surface p-5 shadow-sm ring-1 ring-border">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-primary text-primary-fg"><Play className="size-5" strokeWidth={2} fill="currentColor" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-fg">Part 2 — Describe a place you visited</p>
          <div className="mt-2 flex h-6 items-end gap-0.5">
            {[6, 14, 9, 20, 12, 17, 8, 15, 11, 19, 7, 13, 10, 16, 9, 14, 6, 18, 12, 8].map((h, i) => (
              <span key={i} className="w-1 rounded-full bg-primary/40" style={{ height: `${h}px` }} />
            ))}
          </div>
        </div>
        <span className="shrink-0 text-xs font-semibold text-fg-subtle">1:52</span>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Mic className="size-4 text-accent-strong" strokeWidth={1.75} />
        <p className="text-xs font-semibold text-fg-subtle">Teacher feedback</p>
      </div>
      <p className="mt-2 rounded-xl bg-surface p-4 text-sm leading-relaxed text-fg shadow-sm ring-1 ring-border">
        Good range of vocabulary and a natural pace. Watch your use of filler words at the start of answers, and try
        to extend your examples with a specific detail.
      </p>
      <div className="mt-4 grid grid-cols-4 gap-3 text-center">
        {[['Fluency', '7.0'], ['Vocabulary', '7.5'], ['Grammar', '6.5'], ['Pronunciation', '7.0']].map(([k, v]) => (
          <div key={k} className="rounded-xl bg-surface p-3 shadow-sm ring-1 ring-border">
            <p className="text-[11px] font-semibold text-fg-subtle">{k}</p>
            <p className="mt-1 text-base font-bold text-fg">{v}</p>
          </div>
        ))}
      </div>
    </Frame>
  );
}
