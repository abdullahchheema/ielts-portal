'use client';

import { useState } from 'react';
import { Alert, Button, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

const KINDS = ['CNIC', 'CV', 'DEGREE', 'CERTIFICATE', 'OTHER'] as const;

/** Uploads supporting documents one at a time against an already-created teacher application id. */
export function TeacherDocumentsUploader({ applicationId, onDone }: { applicationId: string; onDone: () => void }) {
  const [kind, setKind] = useState<(typeof KINDS)[number]>('CNIC');
  const [file, setFile] = useState<File | null>(null);
  const [uploaded, setUploaded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('kind', kind);
      await api(`/teacher-applications/${applicationId}/documents`, { form });
      setUploaded((u) => [...u, `${kind}: ${file.name}`]);
      setFile(null);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <p className="text-sm text-fg-muted">Upload supporting documents one at a time (JPG, PNG, WebP or PDF, up to 8MB each).</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44"><Select aria-label="Document type" value={kind} onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}>
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </Select></div>
        <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
        <Button type="button" disabled={!file} busy={busy} onClick={upload}>Upload</Button>
      </div>
      {uploaded.length > 0 && (
        <ul className="list-inside list-disc text-sm text-fg-muted">{uploaded.map((u, i) => <li key={i}>{u}</li>)}</ul>
      )}
      <div className="flex justify-end border-t border-border pt-4"><Button onClick={onDone}>Done</Button></div>
    </div>
  );
}
