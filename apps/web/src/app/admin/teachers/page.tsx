'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { TeacherApplicationInput } from '@ielts/validation';
import { TeacherApplicationForm } from '@/components/TeacherApplicationForm';
import { TeacherDetailDialog } from '@/components/TeacherDetailDialog';
import { TeacherDocumentsUploader } from '@/components/TeacherDocumentsUploader';
import { Alert, Badge, Button, ClickableRow, DetailDialog, Empty, Loading, PageHeader, Table, Td, useConfirm } from '@/components/ui';
import { api } from '@/lib/api';
import { can, useMe } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';

interface Mentor { id: string; displayName: string; status: string; specializations: string[]; user: { email: string }; _count: { batches: number } }
interface AdminMentorDetail { application: (Record<string, unknown> & { id: string }) | null }

/** Drops child-record arrays and coerces dates/numbers so an application record can seed the edit form. */
function toFormDefaults(app: Record<string, unknown>): Partial<TeacherApplicationInput> {
  const { educations: _e, experiences: _x, certifications: _c, references: _r, documents: _d, mentor: _m, id: _id, status: _s, submittedAt: _sa, reviewedAt: _ra, reviewedBy: _rb, createdAt: _ca, updatedAt: _ua, ...rest } = app as Record<string, unknown>;
  const out: Record<string, unknown> = { ...rest };
  for (const key of ['dateOfBirth', 'joiningDate']) {
    const v = out[key];
    if (typeof v === 'string') out[key] = v.slice(0, 10);
  }
  for (const key of ['expectedSalary', 'expectedHourlyRate', 'teachingYears', 'ieltsYears', 'otherEnglishYears']) {
    if (out[key] !== null && out[key] !== undefined) out[key] = String(out[key]);
  }
  return out as Partial<TeacherApplicationInput>;
}

export default function TeachersPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin-mentors'], queryFn: () => api<Mentor[]>('/admin/mentors') });
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<'form' | 'documents'>('form');
  const [newId, setNewId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [editMentor, setEditMentor] = useState<Mentor | null>(null);
  const [editApplicationId, setEditApplicationId] = useState<string | null>(null);
  const [editDefaults, setEditDefaults] = useState<Partial<TeacherApplicationInput> | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const me = useMe();
  const confirm = useConfirm();

  async function removeTeacher(m: Mentor) {
    const ok = await confirm({
      title: 'Remove this teacher?',
      message: `${m.displayName} (${m.user.email}) will be signed out, removed from all their batches and will not be able to log in. Their past sessions and grading are kept.`,
      tone: 'danger', confirmLabel: 'Remove teacher',
    });
    if (!ok) return;
    setRemoveError(null);
    try {
      await api(`/admin/mentors/${m.id}/remove`, { method: 'POST' });
      await qc.invalidateQueries({ queryKey: ['admin-mentors'] });
    } catch (e) { setRemoveError(errorMessage(e)); }
  }

  async function create(values: TeacherApplicationInput) {
    setBusy(true); setError(null);
    try {
      const res = await api<{ id: string; mentorId: string }>('/admin/teachers', { body: values });
      await qc.invalidateQueries({ queryKey: ['admin-mentors'] });
      setNewId(res.id);
      setStage('documents');
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  function closeCreate() {
    setOpen(false); setStage('form'); setNewId(null); setError(null);
  }

  async function startEdit(m: Mentor) {
    setEditMentor(m); setEditError(null); setEditLoading(true); setEditApplicationId(null); setEditDefaults(null);
    try {
      const detail = await api<AdminMentorDetail>(`/admin/mentors/${m.id}`);
      if (detail.application) {
        setEditApplicationId(detail.application.id);
        setEditDefaults(toFormDefaults(detail.application));
      }
    } finally { setEditLoading(false); }
  }

  async function saveEdit(values: TeacherApplicationInput) {
    if (!editApplicationId) return;
    setEditBusy(true); setEditError(null);
    const { educations: _e, experiences: _x, certifications: _c, references: _r, ...scalars } = values;
    try {
      await api(`/admin/teacher-applications/${editApplicationId}`, { method: 'PATCH', body: scalars });
      await qc.invalidateQueries({ queryKey: ['admin-mentors'] });
      await qc.invalidateQueries({ queryKey: ['admin-mentor', editMentor?.id] });
      setEditMentor(null); setEditApplicationId(null);
    } catch (e) { setEditError(errorMessage(e)); } finally { setEditBusy(false); }
  }

  return (
    <>
      <PageHeader title="Teachers" subtitle="Teachers only see the batches they are assigned to." actions={<Button onClick={() => setOpen(true)}>Add teacher</Button>} />
      {isLoading && <Loading />}
      {isError && <Alert>Could not load teachers.</Alert>}
      {removeError && <div className="mb-4"><Alert>{removeError}</Alert></div>}
      {data && (data.length === 0 ? <Empty>No teachers yet.</Empty> : (
        <Table head={['Name', 'Email', 'Specializations', 'Batches', 'Status', '']}>
          {data.map((m) => (
            <ClickableRow key={m.id} onClick={() => setViewId(m.id)}>
              <Td className="font-medium">{m.displayName}</Td><Td>{m.user.email}</Td><Td>{m.specializations.join(', ') || '—'}</Td><Td>{m._count.batches}</Td><Td><Badge status={m.status} /></Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  <Button variant="ghost" className="!py-1" onClick={(e) => { e.stopPropagation(); startEdit(m); }}>Edit</Button>
                  {can(me.data, 'teacher.manage') && <Button variant="ghost" tone="danger" className="!py-1" onClick={(e) => { e.stopPropagation(); removeTeacher(m); }}>Remove</Button>}
                </div>
              </Td>
            </ClickableRow>
          ))}
        </Table>
      ))}

      <DetailDialog open={open} onClose={closeCreate} title="Add teacher" subtitle={stage === 'documents' ? 'Attach supporting documents (optional)' : undefined}>
        {stage === 'form' && <TeacherApplicationForm onSubmit={create} busy={busy} serverError={error} submitLabel="Create & invite" />}
        {stage === 'documents' && newId && <TeacherDocumentsUploader applicationId={newId} onDone={closeCreate} />}
      </DetailDialog>

      <DetailDialog open={!!editMentor} onClose={() => setEditMentor(null)} title={`Edit — ${editMentor?.displayName ?? ''}`}>
        {editLoading && <Loading />}
        {editMentor && !editLoading && editApplicationId === null && (
          <Alert kind="info">This teacher has no linked application record (created before the detailed form existed), so inline editing is not available here. Use the Staff or Batches pages for basic changes.</Alert>
        )}
        {editMentor && !editLoading && editApplicationId && editDefaults && (
          <TeacherApplicationForm
            defaultValues={editDefaults}
            onSubmit={saveEdit}
            busy={editBusy}
            serverError={editError}
            submitLabel="Save changes"
          />
        )}
      </DetailDialog>

      <TeacherDetailDialog mentorId={viewId} onClose={() => setViewId(null)} />
    </>
  );
}
