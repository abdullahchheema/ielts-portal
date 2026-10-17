'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Dialog, Empty, Field, Loading, PageHeader, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date } from '@/lib/format';
import { PlanGate } from '@/components/PlanGate';

interface ServiceRow { id: string; name: string; description: string | null; serviceType: string }
interface BookingRow { id: string; status: string; scheduledAt: string | null; notes: string | null; createdAt: string; service: ServiceRow }

const TYPE_LABEL: Record<string, string> = {
  CONSULTANCY: 'Foreign university consultancy', SCHOLARSHIP_GUIDANCE: 'Scholarship guidance',
  CAREER_COUNSELING: 'Career counseling', SPORTS_BENEFIT: 'Sports benefit',
};

function BookingDialog({ service, onClose }: { service: ServiceRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!service) return;
    setBusy(true); setError(null);
    try {
      await api('/me/premium-services/bookings', { method: 'POST', body: { serviceId: service.id, notes: notes || undefined } });
      await qc.invalidateQueries({ queryKey: ['premium-bookings'] });
      setNotes(''); onClose();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Dialog open={!!service} onClose={onClose} title={`Request: ${service?.name ?? ''}`}>
      <div className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <Field label="What would you like help with? (optional)">{(p) => <Textarea {...p} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} busy={busy}>Request</Button></div>
      </div>
    </Dialog>
  );
}

function PremiumServicesContent() {
  const [requesting, setRequesting] = useState<ServiceRow | null>(null);
  const services = useQuery({ queryKey: ['premium-services'], queryFn: () => api<ServiceRow[]>('/me/premium-services') });
  const bookings = useQuery({ queryKey: ['premium-bookings'], queryFn: () => api<BookingRow[]>('/me/premium-services/bookings') });

  return (
    <>
      <div className="mb-8 grid gap-4 sm:grid-cols-2">
        {(services.data ?? []).map((s) => (
          <Card key={s.id}>
            <p className="mb-1 text-xs font-semibold uppercase text-fg-muted">{TYPE_LABEL[s.serviceType] ?? s.serviceType}</p>
            <h3 className="mb-2 font-semibold">{s.name}</h3>
            {s.description && <p className="mb-4 text-sm text-fg-muted">{s.description}</p>}
            <Button onClick={() => setRequesting(s)}>Request</Button>
          </Card>
        ))}
      </div>

      <h2 className="mb-3 font-semibold">Your requests</h2>
      {bookings.isLoading && <Loading />}
      {bookings.data && (bookings.data.length === 0 ? <Empty title="No requests yet" /> : (
        <div className="space-y-3">
          {bookings.data.map((b) => (
            <Card key={b.id} className="flex items-center justify-between">
              <div>
                <p className="font-medium">{b.service.name}</p>
                <p className="text-xs text-fg-muted">Requested {date(b.createdAt)}{b.scheduledAt ? ` · Scheduled ${date(b.scheduledAt)}` : ''}</p>
              </div>
              <Badge status={b.status} />
            </Card>
          ))}
        </div>
      ))}
      <BookingDialog service={requesting} onClose={() => setRequesting(null)} />
    </>
  );
}

export default function StudentPremiumPage() {
  return (
    <>
      <PageHeader title="Premium services" subtitle="Consultancy, scholarship guidance, career counseling and more — available on the Premium plan." />
      <PlanGate feature="premium.services" message="These coaching services are available on the Premium plan.">
        <PremiumServicesContent />
      </PlanGate>
    </>
  );
}
