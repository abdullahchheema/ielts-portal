'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Badge, DefinitionList, DetailDialog, Empty, Loading, Section, Table, Td } from '@/components/ui';
import { ReceiptViewer } from '@/components/ReceiptViewer';
import { api } from '@/lib/api';
import { date } from '@/lib/format';

interface Education { id: string; degree: string; field: string | null; institution: string; country: string | null; startYear: number | null; endYear: number | null; grade: string | null }
interface Experience { id: string; organization: string; jobTitle: string; employmentType: string | null; startDate: string | null; endDate: string | null; current: boolean; responsibilities: string | null; reasonForLeaving: string | null }
interface Certification { id: string; name: string; issuer: string | null; issuedAt: string | null; expiresAt: string | null }
interface ReferenceEntry { id: string; name: string; organization: string | null; position: string | null; relationship: string | null; phone: string | null; email: string | null }
interface Document { id: string; kind: string; label: string | null; fileMime: string; fileUrl: string }
interface Application {
  id: string; fullName: string; fatherName: string | null; dateOfBirth: string | null; gender: string | null; nationality: string | null; idNumber: string | null; maritalStatus: string | null;
  phone: string; email: string; currentAddress: string | null; permanentAddress: string | null; city: string | null;
  emergencyName: string | null; emergencyRelation: string | null; emergencyPhone: string | null;
  subjects: string[]; ieltsModules: string[]; teachingYears: string | null; ieltsYears: string | null; otherEnglishYears: string | null; levelsTaught: string | null;
  onlineExperience: boolean | null; inPersonExperience: boolean | null; preferredMode: string | null; languages: string[]; skills: string[];
  availableDays: string[]; availableTime: string | null; employmentType: string | null; workingHours: string | null; joiningDate: string | null; noticePeriod: string | null;
  expectedSalary: string | null; expectedHourlyRate: string | null;
  achievements: string | null; publications: string | null; memberships: string | null; personalStatement: string | null; notes: string | null;
  educations: Education[]; experiences: Experience[]; certifications: Certification[]; references: ReferenceEntry[]; documents: Document[];
}
interface Mentor {
  id: string; displayName: string; bio: string | null; specializations: string[]; status: string;
  user: { email: string; phone: string | null; status: string; createdAt: string; lastLoginAt: string | null };
  batches: { batch: { id: string; name: string; status: string } }[];
  application: Application | null;
}

const TABS = [
  { key: 'personal', label: 'Personal' },
  { key: 'contact', label: 'Contact' },
  { key: 'academic', label: 'Academic' },
  { key: 'teaching', label: 'Teaching' },
  { key: 'certifications', label: 'Certifications' },
  { key: 'references', label: 'References' },
  { key: 'documents', label: 'Documents' },
  { key: 'batches', label: 'Batches' },
];

export function TeacherDetailDialog({ mentorId, onClose }: { mentorId: string | null; onClose: () => void }) {
  const [tab, setTab] = useState('personal');
  const { data: m, isLoading, isError } = useQuery({
    queryKey: ['admin-mentor', mentorId],
    queryFn: () => api<Mentor>(`/admin/mentors/${mentorId}`),
    enabled: !!mentorId,
  });
  const a = m?.application;

  return (
    <DetailDialog open={!!mentorId} onClose={onClose} title={m?.displayName ?? 'Teacher'} subtitle={m?.user.email} tabs={TABS} activeTab={tab} onTabChange={setTab}>
      {isLoading && <Loading />}
      {isError && <Alert>Could not load this teacher.</Alert>}
      {m && !a && (
        <Section>
          <Alert kind="info">This teacher was created before the detailed application form existed, so only basic profile fields are available.</Alert>
          <div className="mt-4"><DefinitionList items={[
            { label: 'Name', value: m.displayName },
            { label: 'Email', value: m.user.email },
            { label: 'Phone', value: m.user.phone },
            { label: 'Specializations', value: m.specializations.join(', ') || '—' },
            { label: 'Bio', value: m.bio },
            { label: 'Status', value: <Badge status={m.status} /> },
          ]} /></div>
        </Section>
      )}
      {m && a && (
        <>
          {tab === 'personal' && (
            <Section>
              <DefinitionList items={[
                { label: 'Full name', value: a.fullName },
                { label: "Father's name", value: a.fatherName },
                { label: 'Date of birth', value: a.dateOfBirth ? date(a.dateOfBirth) : null },
                { label: 'Gender', value: a.gender },
                { label: 'Nationality', value: a.nationality },
                { label: 'ID number', value: a.idNumber },
                { label: 'Marital status', value: a.maritalStatus },
                { label: 'Status', value: <Badge status={m.status} /> },
              ]} />
            </Section>
          )}
          {tab === 'contact' && (
            <Section>
              <DefinitionList items={[
                { label: 'Phone', value: a.phone },
                { label: 'Email', value: a.email },
                { label: 'City', value: a.city },
                { label: 'Current address', value: a.currentAddress },
                { label: 'Permanent address', value: a.permanentAddress },
                { label: 'Emergency contact', value: a.emergencyName },
                { label: 'Relation', value: a.emergencyRelation },
                { label: 'Emergency phone', value: a.emergencyPhone },
              ]} />
            </Section>
          )}
          {tab === 'academic' && (
            <Section title="Education">
              {a.educations.length === 0 ? <Empty>No education records.</Empty> : (
                <Table head={['Degree', 'Institution', 'Country', 'Years', 'Grade']}>
                  {a.educations.map((e) => <tr key={e.id}><Td>{e.degree}{e.field ? ` (${e.field})` : ''}</Td><Td>{e.institution}</Td><Td>{e.country ?? '—'}</Td><Td>{e.startYear ?? '—'}–{e.endYear ?? '—'}</Td><Td>{e.grade ?? '—'}</Td></tr>)}
                </Table>
              )}
              <h3 className="mb-2 mt-5 text-sm font-semibold text-fg">Experience</h3>
              {a.experiences.length === 0 ? <Empty>No experience records.</Empty> : (
                <Table head={['Organization', 'Title', 'Type', 'Dates']}>
                  {a.experiences.map((e) => <tr key={e.id}><Td>{e.organization}</Td><Td>{e.jobTitle}</Td><Td>{e.employmentType ?? '—'}</Td><Td>{date(e.startDate)} – {e.current ? 'Present' : date(e.endDate)}</Td></tr>)}
                </Table>
              )}
            </Section>
          )}
          {tab === 'teaching' && (
            <Section>
              <DefinitionList items={[
                { label: 'Subjects', value: a.subjects.join(', ') || '—' },
                { label: 'IELTS modules', value: a.ieltsModules.join(', ') || '—' },
                { label: 'Teaching years', value: a.teachingYears },
                { label: 'IELTS years', value: a.ieltsYears },
                { label: 'Other English years', value: a.otherEnglishYears },
                { label: 'Levels taught', value: a.levelsTaught },
                { label: 'Online experience', value: a.onlineExperience === null ? '—' : a.onlineExperience ? 'Yes' : 'No' },
                { label: 'In-person experience', value: a.inPersonExperience === null ? '—' : a.inPersonExperience ? 'Yes' : 'No' },
                { label: 'Preferred mode', value: a.preferredMode },
                { label: 'Languages', value: a.languages.join(', ') || '—' },
                { label: 'Skills', value: a.skills.join(', ') || '—' },
                { label: 'Available days', value: a.availableDays.join(', ') || '—' },
                { label: 'Available time', value: a.availableTime },
                { label: 'Employment type', value: a.employmentType },
                { label: 'Working hours', value: a.workingHours },
                { label: 'Joining date', value: a.joiningDate ? date(a.joiningDate) : null },
                { label: 'Notice period', value: a.noticePeriod },
                { label: 'Expected salary', value: a.expectedSalary },
                { label: 'Expected hourly rate', value: a.expectedHourlyRate },
              ]} />
              {a.personalStatement && <p className="mt-4 whitespace-pre-wrap text-sm text-fg">{a.personalStatement}</p>}
            </Section>
          )}
          {tab === 'certifications' && (
            <Section title="Certifications">
              {a.certifications.length === 0 ? <Empty>None recorded.</Empty> : (
                <Table head={['Name', 'Issuer', 'Issued', 'Expires']}>
                  {a.certifications.map((c) => <tr key={c.id}><Td>{c.name}</Td><Td>{c.issuer ?? '—'}</Td><Td>{date(c.issuedAt)}</Td><Td>{date(c.expiresAt)}</Td></tr>)}
                </Table>
              )}
              {(a.achievements || a.publications || a.memberships) && (
                <div className="mt-4 space-y-3 text-sm">
                  {a.achievements && <p><strong>Achievements:</strong> {a.achievements}</p>}
                  {a.publications && <p><strong>Publications:</strong> {a.publications}</p>}
                  {a.memberships && <p><strong>Memberships:</strong> {a.memberships}</p>}
                </div>
              )}
            </Section>
          )}
          {tab === 'references' && (
            <Section title="References">
              {a.references.length === 0 ? <Empty>None recorded.</Empty> : (
                <Table head={['Name', 'Organization', 'Position', 'Relationship', 'Contact']}>
                  {a.references.map((r) => <tr key={r.id}><Td>{r.name}</Td><Td>{r.organization ?? '—'}</Td><Td>{r.position ?? '—'}</Td><Td>{r.relationship ?? '—'}</Td><Td>{r.phone ?? r.email ?? '—'}</Td></tr>)}
                </Table>
              )}
            </Section>
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
              {a.notes && <p className="mt-4 text-sm text-fg"><strong>Notes:</strong> {a.notes}</p>}
            </Section>
          )}
          {tab === 'batches' && (
            <Section title="Assigned batches">
              {m.batches.length === 0 ? <Empty>Not assigned to any batch yet.</Empty> : (
                <Table head={['Batch', 'Status']}>
                  {m.batches.map((b) => <tr key={b.batch.id}><Td>{b.batch.name}</Td><Td><Badge status={b.batch.status} /></Td></tr>)}
                </Table>
              )}
            </Section>
          )}
        </>
      )}
    </DetailDialog>
  );
}
