'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Badge, Button, DefinitionList, DetailDialog, Empty, Field, Loading, Section, Table, Td, Textarea } from '@/components/ui';
import { ReceiptViewer } from '@/components/ReceiptViewer';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date } from '@/lib/format';

interface Document { id: string; kind: string; label: string | null; fileMime: string; fileUrl: string }
interface Detail {
  id: string; status: string; fullName: string; fatherName: string | null; dateOfBirth: string | null; gender: string | null;
  phone: string; email: string; city: string | null; subjects: string[]; ieltsModules: string[];
  teachingYears: string | null; ieltsYears: string | null; preferredMode: string | null; expectedSalary: string | null; expectedHourlyRate: string | null;
  personalStatement: string | null; notes: string | null; submittedAt: string; reviewedAt: string | null;
  educations: { id: string; degree: string; institution: string }[];
  experiences: { id: string; organization: string; jobTitle: string }[];
  documents: Document[];
  mentor: { id: string } | null;
}

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'background', label: 'Background' },
  { key: 'documents', label: 'Documents' },
];

export function TeacherApplicationDetailDialog({ applicationId, onClose, onChanged }: { applicationId: string | null; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState('overview');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: a, isLoading, isError } = useQuery({
    queryKey: ['admin-teacher-application', applicationId],
    queryFn: () => api<Detail>(`/admin/teacher-applications/${applicationId}`),
    enabled: !!applicationId,
  });

  const approve = useMutation({
    mutationFn: () => api(`/admin/teacher-applications/${applicationId}/approve`, { method: 'POST' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-teacher-application', applicationId] }); onChanged(); },
    onError: (e) => setError(errorMessage(e)),
  });
  const reject = useMutation({
    mutationFn: () => api(`/admin/teacher-applications/${applicationId}/reject`, { method: 'POST', body: { reason } }),
    onSuccess: () => { setRejecting(false); setReason(''); qc.invalidateQueries({ queryKey: ['admin-teacher-application', applicationId] }); onChanged(); },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <DetailDialog
      open={!!applicationId}
      onClose={onClose}
      title={a?.fullName ?? 'Teacher application'}
      subtitle={a?.email}
      tabs={TABS}
      activeTab={tab}
      onTabChange={setTab}
      actions={a?.status === 'PENDING' && (
        <>
          <Button variant="secondary" className="!py-1.5" onClick={() => { setError(null); approve.mutate(); }} busy={approve.isPending}>Approve</Button>
          <Button variant="danger" className="!py-1.5" onClick={() => { setError(null); setRejecting(true); }}>Reject</Button>
        </>
      )}
    >
      {isLoading && <Loading />}
      {isError && <Alert>Could not load this application.</Alert>}
      {a && (
        <>
          {error && <div className="mb-4"><Alert>{error}</Alert></div>}
          {rejecting && (
            <div className="mb-5 rounded-lg bg-red-50 p-4 ring-1 ring-red-200">
              <h3 className="mb-2 text-sm font-semibold text-red-900">Reject application</h3>
              <Field label="Reason (shown to the applicant)">{(p) => <Textarea {...p} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="secondary" className="!py-1.5" onClick={() => setRejecting(false)}>Cancel</Button>
                <Button variant="danger" className="!py-1.5" busy={reject.isPending} disabled={reason.trim().length < 3} onClick={() => reject.mutate()}>Confirm reject</Button>
              </div>
            </div>
          )}
          {tab === 'overview' && (
            <Section>
              <div className="mb-3"><Badge status={a.status} /></div>
              <DefinitionList items={[
                { label: 'Full name', value: a.fullName },
                { label: "Father's name", value: a.fatherName },
                { label: 'Date of birth', value: a.dateOfBirth ? date(a.dateOfBirth) : null },
                { label: 'Gender', value: a.gender },
                { label: 'Phone', value: a.phone },
                { label: 'Email', value: a.email },
                { label: 'City', value: a.city },
                { label: 'Subjects', value: a.subjects.join(', ') || '—' },
                { label: 'IELTS modules', value: a.ieltsModules.join(', ') || '—' },
                { label: 'Teaching years', value: a.teachingYears },
                { label: 'IELTS years', value: a.ieltsYears },
                { label: 'Preferred mode', value: a.preferredMode },
                { label: 'Expected salary', value: a.expectedSalary },
                { label: 'Expected hourly rate', value: a.expectedHourlyRate },
                { label: 'Submitted', value: date(a.submittedAt, true) },
                { label: 'Reviewed', value: a.reviewedAt ? date(a.reviewedAt, true) : '—' },
              ]} />
              {a.personalStatement && <p className="mt-4 whitespace-pre-wrap text-sm text-slate-700">{a.personalStatement}</p>}
              {a.mentor && <Alert kind="success">Approved — teacher account created.</Alert>}
            </Section>
          )}
          {tab === 'background' && (
            <Section title="Education">
              {a.educations.length === 0 ? <Empty>None recorded.</Empty> : (
                <Table head={['Degree', 'Institution']}>{a.educations.map((e) => <tr key={e.id}><Td>{e.degree}</Td><Td>{e.institution}</Td></tr>)}</Table>
              )}
              <h3 className="mb-2 mt-5 text-sm font-semibold text-slate-900">Experience</h3>
              {a.experiences.length === 0 ? <Empty>None recorded.</Empty> : (
                <Table head={['Organization', 'Title']}>{a.experiences.map((e) => <tr key={e.id}><Td>{e.organization}</Td><Td>{e.jobTitle}</Td></tr>)}</Table>
              )}
              {a.notes && <p className="mt-4 text-sm text-slate-700"><strong>Notes:</strong> {a.notes}</p>}
            </Section>
          )}
          {tab === 'documents' && (
            <Section title="Documents">
              {a.documents.length === 0 ? <Empty>No documents uploaded.</Empty> : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {a.documents.map((d) => (
                    <div key={d.id}>
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">{d.label || d.kind}</p>
                      <ReceiptViewer fileUrl={d.fileUrl} fileMime={d.fileMime} alt={d.label ?? d.kind} />
                    </div>
                  ))}
                </div>
              )}
            </Section>
          )}
        </>
      )}
    </DetailDialog>
  );
}
