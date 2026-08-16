'use client';

import {
  BookOpen, Check, FileText, LoaderCircle, Save, ShieldAlert, Trash2, Upload,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { DEPARTMENTS, DEPT_BY_ID } from '@/lib/departments';
import {
  DEPT_NOTE_HINTS, DEPT_NOTE_MAX, PROFILE_FIELDS, PROFILE_MAX_TOTAL, profileLength,
} from '@/lib/company';
import {
  canEditOffice, createDoc, deleteDoc, insertChunks, listDocs, saveDeptNote, saveProfile,
  sbError, updateDoc, uploadDocFile, type DocRow,
} from '@/lib/supabase';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Hint } from '@/components/ui/panel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/* ============================================================
   ข้อมูลบริษัท - สามชั้นที่ agent จะอ่านก่อนตอบ
     โปรไฟล์  ทุกแผนกเห็นเหมือนกัน (ฟอร์มมีโครง)
     แผนก     โน้ตเฉพาะแผนก แผนกไหนเห็นของแผนกนั้น
     เอกสาร   ไฟล์จริง ตัดชิ้น + embedding เก็บใน Supabase ค้นตอนถาม (เฟส 3)
   ============================================================ */

interface Props {
  open: boolean;
  onClose: () => void;
  officeId: string | null;
  userId: string | null;
  profile: Record<string, string>;
  deptNotes: Record<string, string>;
  /** บันทึกเสร็จแล้วให้ page โหลดใหม่ - state ของจริงอยู่ที่ page */
  onChanged: () => void;
  /** header คีย์ LLM ที่ใช้อยู่ - ต้องใช้ตอน embed เอกสาร */
  llmHeaders: Record<string, string>;
  llmLabel: string;
  blocked: string | null;
}

export default function CompanyPanel({
  open, onClose, officeId, userId, profile, deptNotes, onChanged, llmHeaders, llmLabel, blocked,
}: Props) {
  const [tab, setTab] = useState('profile');
  const [canEdit, setCanEdit] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [noteDept, setNoteDept] = useState(DEPARTMENTS[0].id);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // เอกสาร
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [uploadDepts, setUploadDepts] = useState<string[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [pasteName, setPasteName] = useState('');
  const [pasteText, setPasteText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // เปิดมาแล้วเอาค่าจริงมาเป็นร่าง - แก้ในร่างจนกว่าจะกดบันทึก
  useEffect(() => {
    if (!open) return;
    setDraft({ ...profile });
    setNotes({ ...deptNotes });
    setMsg(null);
    if (officeId) {
      canEditOffice(officeId).then(setCanEdit).catch(() => setCanEdit(false));
      refreshDocs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, officeId]);

  const refreshDocs = () => {
    if (!officeId) return;
    setDocsLoading(true);
    listDocs(officeId).then(setDocs).catch((e) => setMsg({ ok: false, text: sbError(e) })).finally(() => setDocsLoading(false));
  };

  const total = profileLength(draft);
  const overTotal = total > PROFILE_MAX_TOTAL;

  const doSaveProfile = async () => {
    if (!officeId) return;
    setSaving(true); setMsg(null);
    try {
      const clean = Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, (v ?? '').trim()]).filter(([, v]) => v));
      await saveProfile(officeId, clean, userId);
      onChanged();
      setMsg({ ok: true, text: 'บันทึกโปรไฟล์แล้ว - agent ทุกตัวจะเห็นในคำถามถัดไป' });
    } catch (e) {
      setMsg({ ok: false, text: sbError(e) });
    } finally {
      setSaving(false);
    }
  };

  const doSaveNote = async () => {
    if (!officeId) return;
    setSaving(true); setMsg(null);
    try {
      await saveDeptNote(officeId, noteDept, (notes[noteDept] ?? '').trim(), userId);
      onChanged();
      setMsg({ ok: true, text: `บันทึกโน้ตของ${DEPT_BY_ID.get(noteDept)?.nameTh ?? noteDept}แล้ว` });
    } catch (e) {
      setMsg({ ok: false, text: sbError(e) });
    } finally {
      setSaving(false);
    }
  };

  /**
   * อัปโหลดเอกสาร: อ่านเป็นข้อความ -> /api/embed (ตัดชิ้น + vector ด้วยคีย์ที่ใช้อยู่)
   * -> เก็บชิ้นลง Supabase -> อัปไฟล์ต้นฉบับขึ้น Storage
   * แถว office_doc สร้างก่อนสถานะ processing แล้วค่อยเปลี่ยนเป็น ready/error - ล้มกลางทางก็เห็นว่าพัง
   */
  const ingest = async (name: string, text: string, size: number, file?: File) => {
    if (!officeId) return;
    if (!text.trim()) { setMsg({ ok: false, text: 'ไฟล์ว่าง หรืออ่านเป็นข้อความไม่ได้' }); return; }
    setUploading(name); setMsg(null);
    let row: DocRow | null = null;
    try {
      row = await createDoc({ office_id: officeId, name, dept_ids: uploadDepts, bytes: size, uploaded_by: userId });
      setDocs((d) => [row!, ...d]);
      const res = await fetch('/api/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...llmHeaders },
        body: JSON.stringify({ document: text }),
      });
      const data = (await res.json()) as { texts?: string[]; vectors?: number[][]; model?: string; error?: string };
      if (!res.ok || !data.texts || !data.vectors || !data.model) throw new Error(data.error ?? `HTTP ${res.status}`);
      await insertChunks(data.texts.map((t, i) => ({
        doc_id: row!.id, office_id: officeId, seq: i, content: t, embedding: data.vectors![i], embed_model: data.model!,
      })));
      if (file) await uploadDocFile(officeId, row.id, file);
      await updateDoc(row.id, { status: 'ready', chunk_count: data.texts.length });
      setMsg({ ok: true, text: `อัปโหลด "${name}" แล้ว ${data.texts.length} ชิ้น - agent จะค้นเจอตอนถามเรื่องที่เกี่ยว` });
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      if (row) await updateDoc(row.id, { status: 'error', error: text }).catch(() => {});
      setMsg({ ok: false, text });
    } finally {
      setUploading(null);
      refreshDocs();
    }
  };

  const onFile = async (file: File) => {
    const ok = /\.(txt|md|markdown|csv|json)$/i.test(file.name);
    if (!ok) {
      setMsg({ ok: false, text: 'ตอนนี้รับเฉพาะไฟล์ข้อความ (.txt .md .csv .json) - PDF/Word ให้แปลงเป็นข้อความก่อน หรือวางข้อความในช่องด้านล่าง' });
      return;
    }
    const text = await file.text();
    await ingest(file.name, text, file.size, file);
  };

  const toggleDept = (id: string) =>
    setUploadDepts((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        icon={<BookOpen />}
        title="ข้อมูลบริษัท"
        description="สิ่งที่ agent ทุกตัวอ่านก่อนตอบ - ทำให้คำตอบเป็นเรื่องของบริษัทเรา ไม่ใช่บริษัทไหนก็ได้"
        wide
      >
        {blocked ? (
          <p className="rounded-box border-2 border-wood-dark bg-wood-deep/60 px-2 py-1.5 text-[11px] leading-relaxed text-brass-lite">{blocked}</p>
        ) : (
          <>
            {!canEdit && (
              <p className="flex items-center gap-1.5 rounded-box border border-ink-600 bg-ink-700 px-2 py-1 text-[11px] text-dim">
                <ShieldAlert className="size-3.5" /> คุณอ่านได้อย่างเดียว - เจ้าของหรือ exec ของออฟฟิศเท่านั้นที่แก้ได้
              </p>
            )}
            <p className="flex items-start gap-1.5 rounded-box border border-dashed border-ink-500 px-2 py-1 text-[10px] leading-relaxed text-dim">
              <ShieldAlert className="mt-px size-3 shrink-0 text-brass" />
              <span>
                ข้อมูลตรงนี้จะถูกส่งไปกับทุกคำถามที่ <b className="text-parchment">{llmLabel}</b> - อย่าใส่รหัสผ่าน เลขบัตร หรือข้อมูลที่ห้ามออกนอกบริษัท
                (Ollama ในเครื่องปลอดภัยสุด free tier บางเจ้าเอาไป train ได้)
              </span>
            </p>

            <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-col">
              <TabsList className="rounded-t-box border border-b-0 border-wood-deep">
                <TabsTrigger value="profile"><BookOpen /> โปรไฟล์</TabsTrigger>
                <TabsTrigger value="depts">แผนก</TabsTrigger>
                <TabsTrigger value="docs"><FileText /> เอกสาร{docs.length ? ` ${docs.length}` : ''}</TabsTrigger>
              </TabsList>

              {/* ---------- โปรไฟล์ ---------- */}
              <TabsContent value="profile" className="min-h-0">
                <div className="flex max-h-[56vh] flex-col gap-2 overflow-y-auto rounded-b-box border border-t-0 border-ink-600 bg-ink-800 p-2.5">
                  {PROFILE_FIELDS.map((f) => {
                    const v = draft[f.key] ?? '';
                    const over = v.length > f.max;
                    return (
                      <Field
                        key={f.key}
                        label={
                          <span className="flex items-center gap-2">
                            {f.label}
                            <span className={`ml-auto text-[10px] font-normal ${over ? 'text-brass' : 'text-dim'}`}>{v.length}/{f.max}</span>
                          </span>
                        }
                        hint={f.hint}
                      >
                        {f.long ? (
                          <Textarea rows={2} value={v} disabled={!canEdit} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} className="h-auto" />
                        ) : (
                          <Input value={v} disabled={!canEdit} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} />
                        )}
                      </Field>
                    );
                  })}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className={`text-[11px] ${overTotal ? 'text-brass' : 'text-dim'}`}>
                    รวม {total.toLocaleString()}/{PROFILE_MAX_TOTAL.toLocaleString()} ตัวอักษร
                    {overTotal && ' - ยาวเกิน จะถูกส่งทุกคอล ตัดให้สั้นลงก่อน'}
                  </span>
                  <Button variant="primary" className="ml-auto" disabled={!canEdit || saving || overTotal} onClick={doSaveProfile}>
                    {saving ? <LoaderCircle className="animate-spin" /> : <Save />} บันทึกโปรไฟล์
                  </Button>
                </div>
              </TabsContent>

              {/* ---------- แผนก ---------- */}
              <TabsContent value="depts" className="min-h-0">
                <div className="rounded-b-box border border-t-0 border-ink-600 bg-ink-800 p-2.5">
                  <div className="mb-2 flex flex-wrap gap-1">
                    {DEPARTMENTS.map((d) => {
                      const on = noteDept === d.id;
                      const has = !!(notes[d.id] ?? '').trim();
                      return (
                        <button
                          key={d.id}
                          onClick={() => setNoteDept(d.id)}
                          className={`flex items-center gap-1.5 rounded-box border-2 px-2 py-1 text-[11px] font-semibold ${on ? 'border-brass bg-ink-700 text-parchment' : 'border-ink-600 bg-ink-800 text-dim hover:border-ink-500'}`}
                        >
                          <i className="size-2 rounded-[2px]" style={{ background: d.color }} />
                          {d.shortTh}
                          {has && <Check className="size-3 text-carpet-lite" />}
                        </button>
                      );
                    })}
                  </div>
                  <Field
                    label={
                      <span className="flex items-center gap-2">
                        ข้อมูลภายในของ{DEPT_BY_ID.get(noteDept)?.nameTh}
                        <span className={`ml-auto text-[10px] font-normal ${(notes[noteDept] ?? '').length > DEPT_NOTE_MAX ? 'text-brass' : 'text-dim'}`}>
                          {(notes[noteDept] ?? '').length}/{DEPT_NOTE_MAX}
                        </span>
                      </span>
                    }
                    hint={`ควรมี: ${DEPT_NOTE_HINTS[noteDept] ?? ''} - เฉพาะคนของแผนกนี้ที่จะเห็น`}
                  >
                    <Textarea
                      rows={9}
                      value={notes[noteDept] ?? ''}
                      disabled={!canEdit}
                      onChange={(e) => setNotes((n) => ({ ...n, [noteDept]: e.target.value }))}
                      className="h-auto font-mono text-[12px]"
                      placeholder="เขียนเป็นข้อ ๆ ได้เลย ไม่ต้องสวย - agent อ่านได้"
                    />
                  </Field>
                  <div className="mt-2 flex justify-end">
                    <Button variant="primary" disabled={!canEdit || saving || (notes[noteDept] ?? '').length > DEPT_NOTE_MAX} onClick={doSaveNote}>
                      {saving ? <LoaderCircle className="animate-spin" /> : <Save />} บันทึกโน้ตแผนกนี้
                    </Button>
                  </div>
                </div>
              </TabsContent>

              {/* ---------- เอกสาร ---------- */}
              <TabsContent value="docs" className="min-h-0">
                <div className="flex max-h-[56vh] flex-col gap-2 overflow-y-auto rounded-b-box border border-t-0 border-ink-600 bg-ink-800 p-2.5">
                  <Hint>
                    เอกสารจะถูกตัดเป็นชิ้น แปลงเป็น vector ด้วย <b className="text-parchment">{llmLabel}</b> แล้วเก็บใน Supabase
                    ตอนถาม ระบบค้นชิ้นที่เกี่ยวมาแนบให้ agent พร้อมอ้างอิงชื่อไฟล์ - ต้องใช้คีย์ที่ทำ embedding ได้ (Gemini / OpenAI / Ollama ที่ pull nomic-embed-text แล้ว)
                  </Hint>

                  <Field label="ให้แผนกไหนอ่านได้" hint="ไม่เลือก = ทุกแผนก  เอกสารกฎหมายเลือกเฉพาะกฎหมาย จะได้ไม่ไปรกหัวการตลาด">
                    <div className="flex flex-wrap gap-1">
                      {DEPARTMENTS.map((d) => {
                        const on = uploadDepts.includes(d.id);
                        return (
                          <button key={d.id} onClick={() => toggleDept(d.id)} disabled={!canEdit}
                            className={`flex items-center gap-1 rounded-box border-2 px-1.5 py-0.5 text-[10px] ${on ? 'border-carpet bg-carpet-dark text-white' : 'border-ink-600 bg-ink-800 text-dim hover:border-ink-500'}`}>
                            <i className="size-2 rounded-[2px]" style={{ background: d.color }} />{d.shortTh}
                          </button>
                        );
                      })}
                    </div>
                  </Field>

                  <div className="flex flex-wrap items-center gap-2">
                    <input ref={fileRef} type="file" accept=".txt,.md,.markdown,.csv,.json" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} />
                    <Button variant="outline" size="sm" disabled={!canEdit || !!uploading} onClick={() => fileRef.current?.click()}>
                      {uploading ? <LoaderCircle className="animate-spin" /> : <Upload />} {uploading ? `กำลังอ่าน ${uploading}` : 'อัปโหลดไฟล์ข้อความ'}
                    </Button>
                    <span className="text-[10px] text-dim">.txt .md .csv .json - PDF/Word แปลงเป็นข้อความก่อน</span>
                  </div>

                  <details className="rounded-box border border-ink-600 bg-ink-700 p-2">
                    <summary className="cursor-pointer text-[11px] text-dim hover:text-parchment">หรือวางข้อความตรงนี้</summary>
                    <div className="mt-2 flex flex-col gap-1.5">
                      <Input value={pasteName} onChange={(e) => setPasteName(e.target.value)} placeholder="ตั้งชื่อเอกสาร เช่น คู่มือพนักงาน 2569" disabled={!canEdit} />
                      <Textarea rows={6} value={pasteText} onChange={(e) => setPasteText(e.target.value)} className="h-auto font-mono text-[11px]" placeholder="วางข้อความทั้งก้อน" disabled={!canEdit} />
                      <Button variant="primary" size="sm" className="self-end"
                        disabled={!canEdit || !!uploading || !pasteName.trim() || !pasteText.trim()}
                        onClick={async () => { await ingest(`${pasteName.trim()}.txt`, pasteText, pasteText.length); setPasteName(''); setPasteText(''); }}>
                        <Upload /> เพิ่มเป็นเอกสาร
                      </Button>
                    </div>
                  </details>

                  {docsLoading && !docs.length ? (
                    <Hint className="py-2 text-center"><LoaderCircle className="inline size-3 animate-spin" /> กำลังโหลดรายการ</Hint>
                  ) : !docs.length ? (
                    <Hint className="py-2 text-center">ยังไม่มีเอกสาร</Hint>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {docs.map((d) => (
                        <li key={d.id} className="flex items-center gap-2 rounded-box border border-ink-600 bg-ink-700 px-2 py-1.5">
                          <FileText className="size-4 shrink-0 text-dim" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12px] font-semibold text-parchment">{d.name}</span>
                            <span className="flex flex-wrap items-center gap-1.5 text-[10px] text-dim">
                              {d.status === 'ready' && <Badge variant="good">{d.chunk_count} ชิ้น</Badge>}
                              {d.status === 'processing' && <Badge variant="brass">กำลังประมวลผล</Badge>}
                              {d.status === 'error' && <Badge variant="bad" title={d.error ?? ''}>พัง - {d.error?.slice(0, 60)}</Badge>}
                              {d.dept_ids.length ? d.dept_ids.map((id) => DEPT_BY_ID.get(id)?.shortTh ?? id).join(', ') : 'ทุกแผนก'}
                              <span>· {(d.bytes / 1024).toFixed(1)} KB</span>
                            </span>
                          </span>
                          {canEdit && (
                            <Button size="icon" variant="ghost" className="size-7" title="ลบเอกสารนี้"
                              onClick={() => { setDocs((x) => x.filter((y) => y.id !== d.id)); deleteDoc(d).catch((e) => { setMsg({ ok: false, text: sbError(e) }); refreshDocs(); }); }}>
                              <Trash2 />
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </TabsContent>
            </Tabs>

            {msg && (
              <p className={`rounded-box border px-2 py-1.5 text-[11px] leading-relaxed ${msg.ok ? 'border-carpet-dark bg-[#22401f] text-carpet-lite' : 'border-wood-dark bg-wood-deep/60 text-brass-lite'}`}>
                {msg.text}
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
