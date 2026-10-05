'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Badge, Button, DefinitionList, DetailDialog, Empty, Field, Loading, Section, Table, Td, Textarea } from '@/components/ui';
import { ReceiptViewer } from '@/components/ReceiptViewer';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { date, label as humanize } from '@/lib/format';

interface Document { id: string; kind: string; label: string | null; fileMime: string; fileUrl: string }
interface Education { id: string; degree: string; field: string | null; institution: string; country: string | null; startYear: number | null; endYear: number | null; grade: string | null }
interface Experience { id: string; organization: string; jobTitle: string; startDate: string | null; endDate: string | null; current: boolean }
interface Certification { id: string; name: string; issuer: string | null; issuedAt: string | null; expiresAt: string | null }
interface Reference { id: string; name: string; organization: string | null; position: string | null; relationship: string | null; phone: string | null; email: string | null }
interface Detail {
  id: string; status: string; fullName: string; email: string; phone: string;
  fatherName: string | null; dateOfBirth: string | null; gender: string | null; nationality: string | null; idNumber: string | null; maritalStatus: string | null;
  city: string | null; currentAddress: string | null; permanentAddress: string | null;
  emergencyName: string | null; emergencyRelation: string | null; emergencyPhone: string | null;
  subjects: string[]; ieltsModules: string[]; languages: string[]; skills: string[];
  teachingYears: string | null; ieltsYears: string | null; otherEnglishYears: string | null; levelsTaught: string | null;
  onlineExperience: boolean | null; inPersonExperience: boolean | null; preferredMode: string | null;
  availableDays: string[]; availableTime: string | null; employmentType: string | null; workingHours: string | null;
  joiningDate: string | null; noticePeriod: string | null;
  expectedSalary: string | null; expectedHourlyRate: string | null;
  achievements: string | null; publications: string | null; memberships: string | null; personalStatement: string | null;
  notes: string | null; rejectionReason: string | null; submittedAt: string; reviewedAt: string | null;
  educations: Education[]; experiences: Experience[]; certifications: Certification[]; references: Reference[];
  documents: Document[];
  mentor: { id: string } | null;
}

const TABS = [
  { key: 'personal', label: 'Personal & contact' },
  { key: 'teaching', label: 'Teaching & availability' },
  { key: 'background', label: 'Education & experience' },
  { key: 'references', label: 'Certifications & references' },
  { key: 'documents', label: 'Documents' },
];

const yesNo = (v: boolean | null) => (v === null ? null : v ? 'Yes' : 'No');
const list = (v: string[]) => v.map((x) => humanize(x)).join(', ') || null;
const dateOrNull = (v: string | null) => (v ? date(v) : null);

export function TeacherApplicationDetailDialog({ applicationId, onClose, onChanged }: { applicationId: string | null; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState('personal');
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
      subtitle={a ? `${a.email} · ${a.status.toLowerCase()}` : undefined}
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
          <div className="mb-4 flex flex-wrap items-center gap-2"><Badge status={a.status} />{a.mentor && <Alert kind="success">Approved — teacher portal is open for this account.</Alert>}</div>
          {a.rejectionReason && <div className="mb-4"><Alert>Rejected: {a.rejectionReason}</Alert></div>}
          {error && <div className="mb-4"><Alert>{error}</Alert></div>}
          {rejecting && (
            <div className="mb-5 rounded-lg bg-danger-soft p-4 ring-1 ring-red-200">
              <h3 className="mb-2 text-sm font-semibold text-red-900">Reject application</h3>
              <Field label="Reason (shown to the applicant)">{(p) => <Textarea {...p} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="secondary" className="!py-1.5" onClick={() => setRejecting(false)}>Cancel</Button>
                <Button variant="danger" className="!py-1.5" busy={reject.isPending} disabled={reason.trim().length < 3} onClick={() => reject.mutate()}>Confirm reject</Button>
              </div>
            </div>
          )}

          {tab === 'personal' && (
            <Section title="Personal">
              <DefinitionList items={[
                { label: 'Full name', value: a.fullName },
                { label: 'Date of birth', value: dateOrNull(a.dateOfBirth) },
                { label: 'Gender', value: a.gender },
                { label: 'Nationality', value: a.nationality },
                { label: 'CNIC', value: a.idNumber },
                { label: 'Marital status', value: a.maritalStatus },
              ]} />
              <h3 className="mb-2 mt-6 text-sm font-semibold text-fg">Contact</h3>
              <DefinitionList items={[
                { label: 'Phone', value: a.phone },
                { label: 'Email', value: a.email },
                { label: 'City', value: a.city },
                { label: 'Current address', value: a.currentAddress },
                { label: 'Emergency contact', value: a.emergencyName },
                { label: 'Relationship', value: a.emergencyRelation },
                { label: 'Emergency phone', value: a.emergencyPhone },
              ]} />
            </Section>
          )}

          {tab === 'teaching' && (
            <Section title="Teaching">
              <DefinitionList items={[
                { label: 'Subjects', value: list(a.subjects) },
                { label: 'IELTS modules', value: list(a.ieltsModules) },
                { label: 'Years of teaching', value: a.teachingYears },
                { label: 'Languages', value: list(a.languages) },
                { label: 'Preferred mode', value: a.preferredMode },
                { label: 'Online teaching experience', value: yesNo(a.onlineExperience) },
                { label: 'In-person teaching experience', value: yesNo(a.inPersonExperience) },
                { label: 'Levels taught', value: a.levelsTaught },
              ]} />
              <h3 className="mb-2 mt-6 text-sm font-semibold text-fg">Availability and pay</h3>
              <DefinitionList items={[
                { label: 'Available days', value: list(a.availableDays) },
                { label: 'Available time', value: a.availableTime },
                { label: 'Employment type', value: a.employmentType },
                { label: 'Working hours', value: a.workingHours },
                { label: 'Date can join', value: dateOrNull(a.joiningDate) },
                { label: 'Notice period', value: a.noticePeriod },
                { label: 'Expected monthly salary', value: a.expectedSalary },
                { label: 'Expected hourly rate', value: a.expectedHourlyRate },
              ]} />
              {a.personalStatement && <p className="mt-4 whitespace-pre-wrap text-sm text-fg"><strong>Personal statement:</strong> {a.personalStatement}</p>}
              {a.achievements && <p className="mt-3 whitespace-pre-wrap text-sm text-fg"><strong>Achievements:</strong> {a.achievements}</p>}
              {a.publications && <p className="mt-3 whitespace-pre-wrap text-sm text-fg"><strong>Publications:</strong> {a.publications}</p>}
              {a.memberships && <p className="mt-3 whitespace-pre-wrap text-sm text-fg"><strong>Memberships:</strong> {a.memberships}</p>}
              {a.notes && <p className="mt-3 whitespace-pre-wrap text-sm text-fg"><strong>Internal notes:</strong> {a.notes}</p>}
            </Section>
          )}

          {tab === 'background' && (
            <>
              <Section title="Education">
                {a.educations.length === 0 ? <Empty>None recorded.</Empty> : (
                  <Table head={['Degree', 'Field', 'Institution', 'Country', 'Years', 'Grade']}>
                    {a.educations.map((e) => (
                      <tr key={e.id}>
                        <Td>{e.degree}</Td><Td>{e.field ?? '—'}</Td><Td>{e.institution}</Td><Td>{e.country ?? '—'}</Td>
                        <Td className="tabular-nums">{[e.startYear, e.endYear].filter(Boolean).join(' – ') || '—'}</Td><Td>{e.grade ?? '—'}</Td>
                      </tr>
                    ))}
                  </Table>
                )}
              </Section>
              <Section title="Work experience">
                {a.experiences.length === 0 ? <Empty>None recorded.</Empty> : (
                  <Table head={['Organization', 'Job title', 'From', 'To']}>
                    {a.experiences.map((e) => (
                      <tr key={e.id}>
                        <Td>{e.organization}</Td><Td>{e.jobTitle}</Td><Td>{dateOrNull(e.startDate) ?? '—'}</Td><Td>{e.current ? 'Current' : dateOrNull(e.endDate) ?? '—'}</Td>
                      </tr>
                    ))}
                  </Table>
                )}
              </Section>
            </>
          )}

          {tab === 'references' && (
            <>
              <Section title="Certifications">
                {a.certifications.length === 0 ? <Empty>None recorded.</Empty> : (
                  <Table head={['Certificate']}>{a.certifications.map((c) => <tr key={c.id}><Td>{c.name}</Td></tr>)}</Table>
                )}
              </Section>
              <Section title="References">
                {a.references.length === 0 ? <Empty>None recorded.</Empty> : (
                  <Table head={['Name', 'Organization', 'Relationship', 'Phone']}>
                    {a.references.map((r) => (
                      <tr key={r.id}><Td>{r.name}</Td><Td>{r.organization ?? '—'}</Td><Td>{r.relationship ? humanize(r.relationship) : '—'}</Td><Td>{r.phone ?? '—'}</Td></tr>
                    ))}
                  </Table>
                )}
              </Section>
            </>
          )}

          {tab === 'documents' && (
            <Section title="Documents">
              {a.documents.length === 0 ? <Empty>No documents uploaded.</Empty> : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {a.documents.map((d) => (
                    <div key={d.id}>
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-muted">{d.label || d.kind}</p>
                      <ReceiptViewer fileUrl={d.fileUrl} fileMime={d.fileMime} alt={d.label ?? d.kind} />
                    </div>
                  ))}
                </div>
              )}
            </Section>
          )}

          <p className="mt-6 text-xs text-fg-muted">Submitted {date(a.submittedAt, true)}{a.reviewedAt ? ` · reviewed ${date(a.reviewedAt, true)}` : ''}</p>
        </>
      )}
    </DetailDialog>
  );
}
