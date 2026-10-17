'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Badge, Button, Dialog, Field, Input, Loading, PageHeader, Select, Table, Td, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date } from '@/lib/format';

interface ServiceRow { id: string; name: string; serviceType: string; active: boolean; _count: { bookings: number } }
interface BookingRow {
  id: string; status: string; scheduledAt: string | null; notes: string | null; adminNotes: string | null; createdAt: string;
  service: { name: string }; student: { firstName: string; lastName: string; user: { email: string } };
}

function DecideDialog({ booking, onClose }: { booking: BookingRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'SCHEDULED' | 'COMPLETED' | 'CANCELLED'>('SCHEDULED');
  const [scheduledAt, setScheduledAt] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!booking) return;
    setBusy(true); setError(null);
    try {
      await api(`/admin/premium-services/bookings/${booking.id}/decide`, {
        method: 'POST', body: { status, scheduledAt: status === 'SCHEDULED' && scheduledAt ? new Date(scheduledAt).toISOString() : undefined, adminNotes: adminNotes || undefined },
      });
      await qc.invalidateQueries({ queryKey: ['admin-premium-bookings'] });
      onClose();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Dialog open={!!booking} onClose={onClose} title={`Update request — ${booking?.service.name ?? ''}`}>
      <div className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <Field label="Status">{(p) => <Select {...p} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="SCHEDULED">Scheduled</option><option value="COMPLETED">Completed</option><option value="CANCELLED">Cancelled</option>
        </Select>}</Field>
        {status === 'SCHEDULED' && <Field label="Scheduled time" hint="Required to confirm — a booking is never shown as confirmed without one.">{(p) => <Input {...p} type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />}</Field>}
        <Field label="Notes (optional)">{(p) => <Textarea {...p} rows={2} value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} />}</Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} busy={busy} disabled={status === 'SCHEDULED' && !scheduledAt}>Save</Button></div>
      </div>
    </Dialog>
  );
}

export default function AdminPremiumServicesPage() {
  const [deciding, setDeciding] = useState<BookingRow | null>(null);
  const services = useQuery({ queryKey: ['admin-premium-services'], queryFn: () => api<ServiceRow[]>('/admin/premium-services') });
  const bookings = useQuery({ queryKey: ['admin-premium-bookings'], queryFn: () => api<BookingRow[]>('/admin/premium-services/bookings') });

  return (
    <>
      <PageHeader title="Premium services" subtitle="Consultancy, scholarship guidance, career counseling and the sports benefit — Premium-only, requested by students." />

      <h2 className="mb-2 font-semibold">Services</h2>
      {services.isLoading ? <Loading /> : (
        <Table head={['Name', 'Type', 'Requests', 'Active']}>
          {(services.data ?? []).map((s) => (
            <tr key={s.id}><Td>{s.name}</Td><Td>{s.serviceType}</Td><Td>{s._count.bookings}</Td><Td><Badge status={s.active ? 'ACTIVE' : 'INACTIVE'} tone={s.active ? 'green' : 'slate'} /></Td></tr>
          ))}
        </Table>
      )}

      <h2 className="mb-2 mt-8 font-semibold">Requests</h2>
      {bookings.isLoading ? <Loading /> : (
        <Table head={['Student', 'Service', 'Status', 'Scheduled', 'Requested', '']}>
          {(bookings.data ?? []).map((b) => (
            <tr key={b.id}>
              <Td>{b.student.firstName} {b.student.lastName}<span className="block text-xs text-fg-muted">{b.student.user.email}</span></Td>
              <Td>{b.service.name}{b.notes && <span className="block text-xs text-fg-muted">{b.notes}</span>}</Td>
              <Td><Badge status={b.status} /></Td>
              <Td>{b.scheduledAt ? date(b.scheduledAt) : '—'}</Td>
              <Td>{date(b.createdAt)}</Td>
              <Td><Button variant="ghost" size="xs" onClick={() => setDeciding(b)}>Update</Button></Td>
            </tr>
          ))}
        </Table>
      )}
      <DecideDialog booking={deciding} onClose={() => setDeciding(null)} />
    </>
  );
}
