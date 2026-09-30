'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date, label } from '@/lib/format';

type Rows = { rawMin: number; rawMax: number; band: string }[];
type Tables = Record<string, { version: number; effectiveDate: string; rows: Rows }[]>;
const BANDS = Array.from({ length: 19 }, (_, i) => (i * 0.5).toFixed(1));

export default function BandConversionsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['bands'], queryFn: () => api<Tables>('/admin/band-conversions') });
  const [type, setType] = useState('LISTENING');
  const [draft, setDraft] = useState<Rows | null>(null);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = data?.[type]?.[0];
  useEffect(() => { setDraft(null); setMsg(null); }, [type]);

  if (isLoading) return <Loading />;
  if (isError || !data) return <Alert>Could not load conversion tables.</Alert>;
  const rows = draft ?? latest?.rows ?? [];
  const edit = (i: number, band: string) => setDraft(rows.map((r, j) => (j === i ? { ...r, band } : r)));

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const res = await api<{ version: number }>('/admin/band-conversions', { method: 'POST', body: { testType: type, rows: rows.map((r) => ({ rawMin: r.rawMin, rawMax: r.rawMax, band: Number(r.band) })) } });
      await qc.invalidateQueries({ queryKey: ['bands'] }); setDraft(null);
      setMsg({ kind: 'success', text: 'Published version ' + res.version + '. New attempts use it; earlier scores keep the band they were awarded.' });
    } catch (e) { setMsg({ kind: 'error', text: errorMessage(e) }); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Band conversion" subtitle="Raw score (out of 40) → band. Shorter tests are scaled to 40 first. Publishing creates a new version; past scores are never changed." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select aria-label="Test type" className="!w-56" value={type} onChange={(e) => setType(e.target.value)}>{['LISTENING', 'READING_ACADEMIC', 'READING_GENERAL'].map((t) => <option key={t} value={t}>{label(t)}</option>)}</Select>
        {latest && <span className="text-sm text-slate-600">Current: version {latest.version}, effective {date(latest.effectiveDate)}</span>}
      </div>
      {msg && <div className="mb-4"><Alert kind={msg.kind}>{msg.text}</Alert></div>}
      <Card className="mb-4"><p className="text-sm text-slate-600">The defaults are the commonly published IELTS tables. Check them against the tables your academy uses before relying on them.</p></Card>
      <Table head={['Raw score', 'Band']}>
        {rows.map((r, i) => (
          <tr key={r.rawMin + '-' + r.rawMax}><Td>{r.rawMin === r.rawMax ? r.rawMin : r.rawMin + ' – ' + r.rawMax}</Td>
            <Td><Select aria-label={'Band for raw ' + r.rawMin + ' to ' + r.rawMax} className="!w-28" value={Number(r.band).toFixed(1)} onChange={(e) => edit(i, e.target.value)}>{BANDS.map((b) => <option key={b}>{b}</option>)}</Select></Td></tr>
        ))}
      </Table>
      <div className="mt-4 flex items-center gap-3"><Button busy={busy} disabled={!draft} onClick={save}>Publish new version</Button>{draft && <Button variant="secondary" onClick={() => setDraft(null)}>Discard changes</Button>}</div>
      {(data[type]?.length ?? 0) > 1 && <p className="mt-4 text-sm text-slate-500">Earlier versions: {data[type].slice(1).map((v) => 'v' + v.version + ' (' + date(v.effectiveDate) + ')').join(', ')}</p>}
    </>
  );
}
