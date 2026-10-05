'use client';

import { useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';
import { Alert, Button, Card, Field, Input, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';

export default function SecurityPage() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true); setError(null);
    try { setSetup(await api('/auth/mfa/setup', { method: 'POST' })); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function confirm() {
    setBusy(true); setError(null);
    try {
      await api('/auth/mfa/confirm', { method: 'POST', body: { code } });
      setSetup(null); setCode('');
      await qc.invalidateQueries({ queryKey: ['me'] });
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Two-factor authentication" subtitle="Admin accounts must use an authenticator app (Google Authenticator, Authy, 1Password…)." />
      <Card className="max-w-xl space-y-4">
        {me?.mfaSetupRequired && <Alert kind="warning">You must enable two-factor authentication before you can use the admin panel.</Alert>}
        {me?.mfaEnabled && <Alert kind="success">Two-factor authentication is enabled on your account. You will be asked for a code each time you log in.</Alert>}
        {error && <Alert>{error}</Alert>}

        {!me?.mfaEnabled && !setup && <Button onClick={start} busy={busy}>Set up authenticator app</Button>}

        {setup && (
          <div className="space-y-4">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-fg">
              <li>Scan this QR code with your authenticator app.</li>
              <li>Enter the 6-digit code it shows to finish.</li>
            </ol>
            <div className="w-fit rounded-lg bg-surface p-3 ring-1 ring-border"><QRCodeSVG value={setup.otpauthUrl} size={176} /></div>
            <p className="text-xs text-fg-muted">Can’t scan? Enter this key manually: <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-fg">{setup.secret}</code></p>
            <Field label="6-digit code">{(p) => <Input {...p} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />}</Field>
            <Button onClick={confirm} busy={busy} disabled={code.length !== 6}>Confirm and enable</Button>
          </div>
        )}
      </Card>
    </>
  );
}
