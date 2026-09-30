'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Dialog, Field, Input, Loading, PageHeader, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { can, useMe } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { band, date, label, money } from '@/lib/format';

interface Version { id: string; versionNumber: number; status: string; publishedAt: string | null }
interface CourseDetail { id: string; title: string; code: string; slug: string; status: string; price: string; currency: string; description: string | null; durationWeeks: number | null; defaultAccessDays: number; versions: Version[] }
interface Item { id: string; title: string; contentType: string; isRequired: boolean; releaseType: string; releaseValue: { date?: string; days?: number; requiredItemId?: string; minScorePercent?: number } | null; metadataJson: { body?: string; url?: string; fileName?: string; assessmentId?: string } | null; estimatedMinutes: number | null }
interface Section { id: string; courseVersionId: string; title: string; items: Item[]; children: Section[] }
interface Tree { id: string; status: string; sections: Section[] }

const TYPES = ['TEXT', 'VIDEO', 'PDF', 'AUDIO', 'QUIZ', 'ASSIGNMENT', 'LISTENING_TEST', 'READING_TEST', 'WRITING_TASK', 'SPEAKING_TASK', 'LIVE_SESSION', 'EXTERNAL_LINK', 'DOWNLOAD', 'MOCK_TEST'];
const RELEASES = ['IMMEDIATE', 'BATCH_DATE', 'RELATIVE', 'PREREQUISITE', 'SCORE_BASED', 'MANUAL'];

const ASSESSMENT_TYPES = ['QUIZ', 'LISTENING_TEST', 'READING_TEST', 'MOCK_TEST'];
const TASK_TYPES = ['WRITING_TASK', 'SPEAKING_TASK', 'ASSIGNMENT'];
interface AssessmentRow { id: string; title: string; type: string; versions: { publishedAt: string | null }[] }
const allItems = (sections: Section[]): Item[] => sections.flatMap((s) => [...s.items, ...allItems(s.children)]);

// ───────── dialogs ─────────
function SectionDialog({ open, onClose, versionId, parentId, onSaved }: { open: boolean; onClose: () => void; versionId: string; parentId: string | null; onSaved: () => void }) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => api(`/admin/course-versions/${versionId}/sections`, { method: 'POST', body: { title, parentSectionId: parentId } }),
    onSuccess: () => { setTitle(''); onSaved(); onClose(); }, onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog open={open} onClose={onClose} title={parentId ? 'New subsection' : 'New section'}>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Title">{(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={m.isPending} disabled={!title.trim()} onClick={() => m.mutate()}>Add</Button></div>
      </div>
    </Dialog>
  );
}

function ItemDialog({ open, onClose, sectionId, item, siblings, onSaved }: { open: boolean; onClose: () => void; sectionId: string; item: Item | null; siblings: Item[]; onSaved: () => void }) {
  const [f, setF] = useState({ title: '', contentType: 'TEXT', isRequired: true, estimatedMinutes: '', releaseType: 'IMMEDIATE', date: '', days: '', requiredItemId: '', minScore: '70', body: '', url: '', assessmentId: '' });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setError(null);
    setF(item ? {
      title: item.title, contentType: item.contentType, isRequired: item.isRequired, estimatedMinutes: item.estimatedMinutes?.toString() ?? '',
      releaseType: item.releaseType, date: item.releaseValue?.date?.slice(0, 16) ?? '', days: item.releaseValue?.days?.toString() ?? '',
      requiredItemId: item.releaseValue?.requiredItemId ?? '', minScore: item.releaseValue?.minScorePercent?.toString() ?? '70', body: item.metadataJson?.body ?? '', url: item.metadataJson?.url ?? '', assessmentId: item.metadataJson?.assessmentId ?? '',
    } : { title: '', contentType: 'TEXT', isRequired: true, estimatedMinutes: '', releaseType: 'IMMEDIATE', date: '', days: '', requiredItemId: '', minScore: '70', body: '', url: '', assessmentId: '' });
  }, [open, item]);

  const m = useMutation({
    mutationFn: () => {
      const releaseValue = f.releaseType === 'BATCH_DATE' ? { date: new Date(f.date).toISOString() }
        : f.releaseType === 'RELATIVE' ? { days: Number(f.days) }
        : f.releaseType === 'PREREQUISITE' ? { requiredItemId: f.requiredItemId }
        : f.releaseType === 'SCORE_BASED' ? { requiredItemId: f.requiredItemId, minScorePercent: Number(f.minScore) }
        : undefined;
      const metadata = { ...(item?.metadataJson ?? {}), ...(f.contentType === 'TEXT' ? { body: f.body } : {}), ...(['VIDEO', 'EXTERNAL_LINK'].includes(f.contentType) ? { url: f.url } : {}), ...(ASSESSMENT_TYPES.includes(f.contentType) && f.assessmentId ? { assessmentId: f.assessmentId } : {}) };
      const body = { title: f.title, contentType: f.contentType, isRequired: f.isRequired, estimatedMinutes: f.estimatedMinutes ? Number(f.estimatedMinutes) : undefined, releaseType: f.releaseType, releaseValue, metadata };
      return item ? api(`/admin/items/${item.id}`, { method: 'PATCH', body }) : api(`/admin/sections/${sectionId}/items`, { method: 'POST', body });
    },
    onSuccess: () => { onSaved(); onClose(); }, onError: (e) => setError(errorMessage(e)),
  });
  const set = (k: keyof typeof f, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));
  const assessments = useQuery({ queryKey: ['admin-assessments'], queryFn: () => api<AssessmentRow[]>('/admin/assessments'), enabled: open && ASSESSMENT_TYPES.includes(f.contentType) });

  return (
    <Dialog open={open} onClose={onClose} title={item ? 'Edit content item' : 'New content item'}>
      <div className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <Field label="Title">{(p) => <Input {...p} value={f.title} onChange={(e) => set('title', e.target.value)} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">{(p) => <Select {...p} value={f.contentType} disabled={!!item} onChange={(e) => set('contentType', e.target.value)}>{TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</Select>}</Field>
          <Field label="Minutes">{(p) => <Input {...p} type="number" min={0} value={f.estimatedMinutes} onChange={(e) => set('estimatedMinutes', e.target.value)} />}</Field>
        </div>
        {f.contentType === 'TEXT' && <Field label="Text">{(p) => <Textarea {...p} rows={5} value={f.body} onChange={(e) => set('body', e.target.value)} />}</Field>}
        {['VIDEO', 'EXTERNAL_LINK'].includes(f.contentType) && <Field label="URL" hint="Direct .mp4 links play inline; other links open in a new tab.">{(p) => <Input {...p} type="url" value={f.url} onChange={(e) => set('url', e.target.value)} />}</Field>}
        {ASSESSMENT_TYPES.includes(f.contentType) && <Field label="Assessment" hint="Build it under Academics → Assessments. Only published assessments can be taken.">{(p) => <Select {...p} value={f.assessmentId} onChange={(e) => set('assessmentId', e.target.value)}><option value="">Select…</option>{assessments.data?.map((a) => <option key={a.id} value={a.id}>{a.title} ({label(a.type)}){a.versions.some((v) => v.publishedAt) ? '' : ' — draft'}</option>)}</Select>}</Field>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isRequired} onChange={(e) => set('isRequired', e.target.checked)} /> Required for course completion</label>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Release">{(p) => <Select {...p} value={f.releaseType} onChange={(e) => set('releaseType', e.target.value)}>{RELEASES.map((r) => <option key={r} value={r}>{label(r)}</option>)}</Select>}</Field>
          {f.releaseType === 'BATCH_DATE' && <Field label="Release at">{(p) => <Input {...p} type="datetime-local" value={f.date} onChange={(e) => set('date', e.target.value)} />}</Field>}
          {f.releaseType === 'RELATIVE' && <Field label="Days after batch start">{(p) => <Input {...p} type="number" min={0} value={f.days} onChange={(e) => set('days', e.target.value)} />}</Field>}
          {f.releaseType === 'PREREQUISITE' && <Field label="Requires">{(p) => <Select {...p} value={f.requiredItemId} onChange={(e) => set('requiredItemId', e.target.value)}><option value="">Select item…</option>{siblings.filter((s) => s.id !== item?.id).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</Select>}</Field>}
        </div>
        {f.releaseType === 'SCORE_BASED' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Test lesson">{(p) => <Select {...p} value={f.requiredItemId} onChange={(e) => set('requiredItemId', e.target.value)}><option value="">Select…</option>{siblings.filter((x) => x.id !== item?.id && ASSESSMENT_TYPES.includes(x.contentType)).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</Select>}</Field>
            <Field label="Minimum score %">{(p) => <Input {...p} type="number" min={0} max={100} value={f.minScore} onChange={(e) => set('minScore', e.target.value)} />}</Field>
          </div>
        )}
        {f.releaseType === 'MANUAL' && <Alert kind="info">Manual release is stored, but the item stays locked until a mentor unlock tool is added.</Alert>}
        <div className="flex justify-end gap-2 pt-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={m.isPending} disabled={!f.title.trim()} onClick={() => m.mutate()}>{item ? 'Save' : 'Add item'}</Button></div>
      </div>
    </Dialog>
  );
}

interface Rubric { id: string; name: string; skill: string }
function TaskDialog({ item, onClose }: { item: Item | null; onClose: () => void }) {
  const rubrics = useQuery({ queryKey: ['rubrics'], queryFn: () => api<Rubric[]>('/admin/rubrics'), enabled: !!item });
  const [f, setF] = useState({ skill: 'WRITING', rubricId: '', instructions: '', dueAt: '', minWords: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (item) { setError(null); setF({ skill: item.contentType === 'SPEAKING_TASK' ? 'SPEAKING' : 'WRITING', rubricId: '', instructions: '', dueAt: '', minWords: '' }); } }, [item]);
  async function save() {
    setBusy(true); setError(null);
    try {
      await api('/admin/items/' + item!.id + '/assignment', { method: 'PUT', body: { skill: f.skill, rubricId: f.rubricId, instructions: f.instructions || undefined, dueAt: f.dueAt ? new Date(f.dueAt).toISOString() : null, minWords: f.minWords ? Number(f.minWords) : null } });
      onClose();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open={!!item} onClose={onClose} title={'Task settings — ' + (item?.title ?? '')}>
      <div className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Skill">{(p) => <Select {...p} value={f.skill} onChange={(e) => setF({ ...f, skill: e.target.value, rubricId: '' })}><option value="WRITING">Writing (typed)</option><option value="SPEAKING">Speaking (audio)</option></Select>}</Field>
          <Field label="Marking rubric">{(p) => <Select {...p} value={f.rubricId} onChange={(e) => setF({ ...f, rubricId: e.target.value })}><option value="">Select…</option>{rubrics.data?.filter((r) => r.skill === f.skill).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>}</Field>
        </div>
        <Field label="Instructions for the student">{(p) => <Textarea {...p} rows={4} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Due (optional)">{(p) => <Input {...p} type="datetime-local" value={f.dueAt} onChange={(e) => setF({ ...f, dueAt: e.target.value })} />}</Field>
          {f.skill === 'WRITING' && <Field label="Minimum words">{(p) => <Input {...p} type="number" min={1} value={f.minWords} onChange={(e) => setF({ ...f, minWords: e.target.value })} />}</Field>}
        </div>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={!f.rubricId} onClick={save}>Save task</Button></div>
      </div>
    </Dialog>
  );
}

// ───────── tree ─────────
function SectionNode({ s, siblings, all, editable, actions }: {
  s: Section; siblings: Section[]; all: Item[]; editable: boolean;
  actions: { addSection: (parent: string) => void; addItem: (sectionId: string) => void; editItem: (sectionId: string, i: Item) => void; taskItem: (i: Item) => void; refresh: () => void };
}) {
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); actions.refresh(); } catch (e) { setError(errorMessage(e)); } };
  const move = (list: { id: string }[], id: string, dir: -1 | 1, url: string) => {
    const ids = list.map((x) => x.id); const i = ids.indexOf(id); const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    return run(() => api(url, { method: 'POST', body: { ids } }));
  };
  const idx = siblings.findIndex((x) => x.id === s.id);

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-slate-900">{s.title}</h3>
        {editable && (
          <div className="flex flex-wrap gap-1 text-xs">
            <Button variant="ghost" className="!px-2 !py-1" disabled={idx === 0} aria-label={`Move ${s.title} up`} onClick={() => move(siblings, s.id, -1, `/admin/course-versions/${s.courseVersionId}/sections/reorder`)}>↑</Button>
            <Button variant="ghost" className="!px-2 !py-1" disabled={idx === siblings.length - 1} aria-label={`Move ${s.title} down`} onClick={() => move(siblings, s.id, 1, `/admin/course-versions/${s.courseVersionId}/sections/reorder`)}>↓</Button>
            <Button variant="ghost" className="!px-2 !py-1" onClick={() => actions.addItem(s.id)}>+ Item</Button>
            <Button variant="ghost" className="!px-2 !py-1" onClick={() => actions.addSection(s.id)}>+ Subsection</Button>
            <Button variant="ghost" className="!px-2 !py-1 text-red-600" onClick={() => confirm(`Delete “${s.title}” and everything in it?`) && run(() => api(`/admin/sections/${s.id}`, { method: 'DELETE' }))}>Delete</Button>
          </div>
        )}
      </div>
      {error && <div className="mt-2"><Alert>{error}</Alert></div>}
      {s.items.length > 0 && (
        <ul className="mt-2 divide-y divide-slate-100 text-sm">
          {s.items.map((i, n) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span>
                {i.title} <span className="text-xs text-slate-500">· {label(i.contentType)}{i.isRequired ? '' : ' · optional'}{i.releaseType !== 'IMMEDIATE' ? ` · ${label(i.releaseType)}` : ''}{i.metadataJson?.fileName ? ` · 📎 ${i.metadataJson.fileName}` : ''}</span>
              </span>
              {editable && (
                <span className="flex flex-wrap items-center gap-1 text-xs">
                  <Button variant="ghost" className="!px-2 !py-1" disabled={n === 0} aria-label={`Move ${i.title} up`} onClick={() => move(s.items, i.id, -1, `/admin/sections/${s.id}/items/reorder`)}>↑</Button>
                  <Button variant="ghost" className="!px-2 !py-1" disabled={n === s.items.length - 1} aria-label={`Move ${i.title} down`} onClick={() => move(s.items, i.id, 1, `/admin/sections/${s.id}/items/reorder`)}>↓</Button>
                  {['PDF', 'AUDIO', 'DOWNLOAD'].includes(i.contentType) && (
                    <label className="cursor-pointer rounded-md px-2 py-1 text-indigo-700 hover:bg-slate-100">Upload file
                      <input type="file" className="sr-only" accept={i.contentType === 'AUDIO' ? 'audio/mpeg' : 'application/pdf,image/*'}
                        onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const fd = new FormData(); fd.append('file', f); run(() => api(`/admin/items/${i.id}/file`, { method: 'POST', form: fd })); e.target.value = ''; }} />
                    </label>
                  )}
                  {TASK_TYPES.includes(i.contentType) && <Button variant="ghost" className="!px-2 !py-1" onClick={() => actions.taskItem(i)}>Task settings</Button>}
                  <Button variant="ghost" className="!px-2 !py-1" onClick={() => actions.editItem(s.id, i)}>Edit</Button>
                  <Button variant="ghost" className="!px-2 !py-1 text-red-600" onClick={() => confirm(`Delete “${i.title}”?`) && run(() => api(`/admin/items/${i.id}`, { method: 'DELETE' }))}>Delete</Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {s.children.length > 0 && (
        <ul className="mt-3 space-y-3 border-l-2 border-slate-100 pl-3">
          {s.children.map((c) => <SectionNode key={c.id} s={c} siblings={s.children} all={all} editable={editable} actions={actions} />)}
        </ul>
      )}
    </li>
  );
}

function CourseDetails({ c, canEdit, onSaved }: { c: CourseDetail; canEdit: boolean; onSaved: () => void }) {
  const [f, setF] = useState({ title: c.title, description: c.description ?? '', price: String(Number(c.price)), durationWeeks: String(c.durationWeeks ?? ''), defaultAccessDays: String(c.defaultAccessDays) });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setMsg(null);
    try {
      await api(`/admin/courses/${c.id}`, { method: 'PATCH', body: { title: f.title, description: f.description, price: Number(f.price), durationWeeks: f.durationWeeks ? Number(f.durationWeeks) : undefined, defaultAccessDays: Number(f.defaultAccessDays) } });
      setMsg({ ok: true, text: 'Course details saved.' }); onSaved();
    } catch (e) { setMsg({ ok: false, text: errorMessage(e) }); } finally { setBusy(false); }
  }
  return (
    <Card className="mb-6">
      <h2 className="mb-3 font-semibold">Course details</h2>
      {msg && <div className="mb-3"><Alert kind={msg.ok ? 'success' : 'error'}>{msg.text}</Alert></div>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title">{(p) => <Input {...p} disabled={!canEdit} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label={`Price (${c.currency})`}>{(p) => <Input {...p} type="number" min={0} disabled={!canEdit} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />}</Field>
        <Field label="Duration (weeks)">{(p) => <Input {...p} type="number" min={1} disabled={!canEdit} value={f.durationWeeks} onChange={(e) => setF({ ...f, durationWeeks: e.target.value })} />}</Field>
        <Field label="Access after enrollment (days)">{(p) => <Input {...p} type="number" min={1} disabled={!canEdit} value={f.defaultAccessDays} onChange={(e) => setF({ ...f, defaultAccessDays: e.target.value })} />}</Field>
        <div className="sm:col-span-2"><Field label="Description">{(p) => <Textarea {...p} rows={3} disabled={!canEdit} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field></div>
      </div>
      {canEdit && <div className="mt-3"><Button onClick={save} busy={busy} disabled={f.title.trim().length < 2}>Save details</Button></div>}
    </Card>
  );
}

export default function CourseBuilderPage() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [versionId, setVersionId] = useState<string | null>(null);
  const [sectionDlg, setSectionDlg] = useState<{ open: boolean; parent: string | null }>({ open: false, parent: null });
  const [itemDlg, setItemDlg] = useState<{ open: boolean; sectionId: string; item: Item | null }>({ open: false, sectionId: '', item: null });
  const [error, setError] = useState<string | null>(null);
  const [taskItem, setTaskItem] = useState<Item | null>(null);

  const course = useQuery({ queryKey: ['admin-course'], queryFn: () => api<CourseDetail>('/admin/course') });
  const id = course.data?.id;
  const current = versionId ?? course.data?.versions[0]?.id ?? null;
  const tree = useQuery({ queryKey: ['admin-tree', current], queryFn: () => api<Tree>(`/admin/course-versions/${current}/tree`), enabled: !!current });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['admin-tree', current] }); };
  const refreshCourse = () => qc.invalidateQueries({ queryKey: ['admin-course'] });

  const newVersion = useMutation({ mutationFn: () => api<Version>(`/admin/courses/${id}/versions`, { method: 'POST', body: {} }), onSuccess: (v) => { refreshCourse(); setVersionId(v.id); }, onError: (e) => setError(errorMessage(e)) });
  const publish = useMutation({ mutationFn: () => api(`/admin/course-versions/${current}/publish`, { method: 'POST' }), onSuccess: () => { refreshCourse(); refresh(); qc.invalidateQueries({ queryKey: ['admin-courses'] }); }, onError: (e) => setError(errorMessage(e)) });

  if (course.isLoading) return <Loading />;
  if (course.isError || !course.data) return <Alert>The course has not been set up yet. Run the seed to create it.</Alert>;
  const c = course.data;
  const version = c.versions.find((v) => v.id === current);
  const editable = version?.status === 'DRAFT' && can(me, 'content.manage');
  const items = tree.data ? allItems(tree.data.sections) : [];
  const actions = {
    addSection: (parent: string) => setSectionDlg({ open: true, parent }),
    addItem: (sectionId: string) => setItemDlg({ open: true, sectionId, item: null }),
    editItem: (sectionId: string, item: Item) => setItemDlg({ open: true, sectionId, item }),
    taskItem: (item: Item) => setTaskItem(item),
    refresh,
  };

  return (
    <>
      <PageHeader
        title={c.title}
        subtitle={`${c.code} · ${money(c.price, c.currency)} · the only course the academy offers`}
        actions={<>
          <Badge status={c.status} />
        </>}
      />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      <CourseDetails key={c.id + c.title + c.price} c={c} canEdit={can(me, 'course.edit')} onSaved={refreshCourse} />

      <Card className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm font-medium text-slate-700" htmlFor="version">Version</label>
          <Select id="version" className="!w-auto" value={current ?? ''} onChange={(e) => setVersionId(e.target.value)}>
            {c.versions.map((v) => <option key={v.id} value={v.id}>v{v.versionNumber} — {label(v.status)}{v.publishedAt ? ` (${date(v.publishedAt)})` : ''}</option>)}
          </Select>
          {version && <Badge status={version.status} />}
          <div className="ml-auto flex gap-2">
            {can(me, 'course.edit') && !c.versions.some((v) => v.status === 'DRAFT') && <Button variant="secondary" busy={newVersion.isPending} onClick={() => { setError(null); newVersion.mutate(); }}>New version (copy)</Button>}
            {version?.status === 'DRAFT' && can(me, 'course.publish') && <Button busy={publish.isPending} onClick={() => confirm('Publish this version? It becomes read-only.') && publish.mutate()}>Publish version</Button>}
          </div>
        </div>
        {version && version.status !== 'DRAFT' && <p className="mt-3 text-sm text-slate-500">Published versions are read-only so students’ history stays intact. Create a new version to make changes; new batches use the newest published version.</p>}
      </Card>

      {tree.isLoading && <Loading />}
      {tree.data && (
        <>
          {editable && <div className="mb-4"><Button variant="secondary" onClick={() => setSectionDlg({ open: true, parent: null })}>+ Section</Button></div>}
          {tree.data.sections.length === 0 ? <Alert kind="info">No content yet. Add a section, then add lessons to it.</Alert> : (
            <ul className="space-y-3">
              {tree.data.sections.map((s) => <SectionNode key={s.id} s={s} siblings={tree.data!.sections} all={items} editable={editable} actions={actions} />)}
            </ul>
          )}
        </>
      )}

      {current && <SectionDialog open={sectionDlg.open} onClose={() => setSectionDlg({ open: false, parent: null })} versionId={current} parentId={sectionDlg.parent} onSaved={refresh} />}
      <TaskDialog item={taskItem} onClose={() => setTaskItem(null)} />
      <ItemDialog open={itemDlg.open} onClose={() => setItemDlg((d) => ({ ...d, open: false }))} sectionId={itemDlg.sectionId} item={itemDlg.item} siblings={items} onSaved={refresh} />
    </>
  );
}
