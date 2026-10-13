'use client';

import { useState } from 'react';
import { Alert, Button, Dialog, Field, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

const AMBIGUOUS_FREE = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

function randomPassword(length = 12) {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => AMBIGUOUS_FREE[b % AMBIGUOUS_FREE.length]).join('');
}

function isValid(p: string) {
  return p.length >= 10 && p.length <= 128 && /[A-Za-z]/.test(p) && /\d/.test(p);
}

/**
 * Sets a new password for a student, teacher or staff account — account recovery, never a way to see
 * their old one. Passwords are one-way hashed; nobody, including an admin, can read what it used to be.
 * Shared across the student/staff/teacher admin pages, each of which just supplies `userId`/`userLabel`.
 */
export function AdminResetPasswordDialog({ open, onClose, userId, userLabel }: { open: boolean; onClose: () => void; userId: string | null; userLabel: string }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function close() {
    setPassword(''); setError(null); setDone(false);
    onClose();
  }

  async function submit() {
    if (!userId) return;
    setBusy(true); setError(null);
    try {
      await api(`/admin/users/${userId}/reset-password`, { method: 'POST', body: { password } });
      setDone(true);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onClose={close} title={`Reset password — ${userLabel}`}>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        {done ? (
          <>
            <Alert kind="success">Password changed. They are signed out everywhere and will need this new password to log in.</Alert>
            <div className="rounded-lg bg-surface-muted p-3 font-mono text-sm text-fg">{password}</div>
            <p className="text-xs text-fg-muted">Share this with them directly — it will not be shown again, and we don't keep a copy of it anywhere.</p>
            <div className="flex justify-end"><Button onClick={close}>Done</Button></div>
          </>
        ) : (
          <>
            <p className="text-sm text-fg-muted">This sets a new password for <span className="font-medium text-fg">{userLabel}</span> and signs them out of every device. It does not reveal their current password — that isn't possible, by design.</p>
            <Field label="New password" hint="At least 10 characters, with a letter and a number.">
              {(p) => <Input {...p} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />}
            </Field>
            <Button variant="secondary" size="sm" type="button" onClick={() => setPassword(randomPassword())}>Generate a password</Button>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={close}>Cancel</Button>
              <Button busy={busy} disabled={!isValid(password)} onClick={submit}>Set new password</Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
