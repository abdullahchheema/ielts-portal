'use client';

import { useState } from 'react';
import { Alert, Button, FileInput } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

/** Shared by the set detail page and the bulk-import results screen, so audio/image upload never
 *  requires navigating away from wherever the admin is working — including right after an import. */
export function AudioAttach({ setId, sectionIndex, editable, attached, audioUrl, onDone }: {
  setId: string; sectionIndex?: number; editable: boolean; attached: boolean; audioUrl?: string; onDone: () => void | Promise<unknown>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload() {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const qs = sectionIndex !== undefined ? `?sectionIndex=${sectionIndex}` : '';
      const p = await api<{ mode: 'direct' | 'multipart'; url?: string; headers?: Record<string, string>; key?: string }>(
        `/admin/question-sets/${setId}/audio/presign${qs}`, { method: 'POST' },
      );
      if (p.mode === 'multipart') {
        const fd = new FormData();
        fd.append('file', file);
        await api(`/admin/question-sets/${setId}/audio${qs}`, { method: 'POST', form: fd });
      } else {
        const put = await fetch(p.url!, { method: 'PUT', headers: p.headers, body: file });
        if (!put.ok) throw new Error('The upload did not complete. Please try again.');
        await api(`/admin/question-sets/${setId}/audio/complete${qs}`, { method: 'POST', body: { key: p.key } });
      }
      setFile(null);
      await onDone();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  if (!editable) return attached ? <audio controls src={audioUrl} className="h-10 w-full max-w-md" /> : <p className="text-sm text-fg-muted">No audio attached.</p>;
  return (
    <div className="space-y-2">
      {attached && <>
        <p className="text-sm text-success">Audio attached — uploading a new file replaces it.</p>
        {audioUrl && <audio controls src={audioUrl} className="h-10 w-full max-w-md" />}
      </>}
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        <FileInput accept="audio/mpeg,.mp3" file={file} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <Button variant="secondary" onClick={upload} busy={busy} disabled={!file}>Upload MP3</Button>
      </div>
    </div>
  );
}

/** A stimulus image shared by a whole section — a map labelled A-G that several questions in that
 *  section all refer to, shown once above them, the same way a passage or audio is section-wide. */
export function SectionImageAttach({ setId, sectionIndex, onDone }: { setId: string; sectionIndex: number; onDone: () => void | Promise<unknown> }) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload() {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api(`/admin/question-sets/${setId}/images?sectionIndex=${sectionIndex}`, { method: 'POST', form: fd });
      setFile(null);
      await onDone();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-1">
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        <FileInput accept="image/jpeg,image/png,image/webp" file={file} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <Button variant="secondary" size="xs" onClick={upload} busy={busy} disabled={!file}>Attach image to this section</Button>
      </div>
    </div>
  );
}

/** For a question whose stimulus is itself an image (a chart to describe, a diagram to label) — the
 *  prompt text still carries the instruction/question; this is just the visual the student sees
 *  alongside it. */
export function QuestionImageAttach({ questionId, onDone }: { questionId: string; onDone: () => void | Promise<unknown> }) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload() {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api(`/admin/question-sets/questions/${questionId}/images`, { method: 'POST', form: fd });
      setFile(null);
      await onDone();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-1">
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        <FileInput accept="image/jpeg,image/png,image/webp" file={file} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <Button variant="secondary" size="xs" onClick={upload} busy={busy} disabled={!file}>Attach image</Button>
      </div>
    </div>
  );
}
