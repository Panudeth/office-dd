'use client';

import {
  ArrowDown, ArrowUp, BookOpen, Check, FileText, LoaderCircle, Package, Plus, Save, ShieldAlert,
  Trash2, Upload,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { DEPARTMENTS, DEPT_BY_ID } from '@/lib/departments';
import {
  DEPT_NOTE_HINTS, DEPT_NOTE_MAX, PRODUCT_LIMITS, PRODUCT_MAX_COUNT, PROFILE_FIELDS,
  PROFILE_MAX_TOTAL, emptyProduct, productIssue, profileLength, type Product,
} from '@/lib/company';
import {
  canEditOffice, createDoc, deleteDoc, insertChunks, listDocs, saveDeptNote, saveProducts,
  saveProfile, sbError, updateDoc, uploadDocFile, type DocRow,
} from '@/lib/supabase';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { InfoTip } from '@/components/ui/infotip';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Hint } from '@/components/ui/panel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { t } from '@/lib/i18n';

/* ============================================================
   ข้อมูลบริษัท - สี่ชั้นที่ agent จะอ่านก่อนตอบ
     โปรไฟล์  ทุกแผนกเห็นเหมือนกัน (ฟอร์มมีโครง)
     สินค้า   รายการสินค้า/บริการพร้อมราคา ทุกแผนกเห็น
     แผนก     โน้ตเฉพาะแผนก แผนกไหนเห็นของแผนกนั้น
     เอกสาร   ไฟล์จริง ตัดชิ้น + embedding เก็บใน Supabase ค้นตอนถาม (เฟส 3)
   ============================================================ */

interface Props {
  open: boolean;
  onClose: () => void;
  officeId: string | null;
  userId: string | null;
  profile: Record<string, string>;
  products: Product[];
  deptNotes: Record<string, string>;
  /** ข้อมูลที่ตอบลูกค้าได้ ต่อแผนก */
  deptPublicNotes?: Record<string, string>;
  /** บันทึกเสร็จแล้วให้ page โหลดใหม่ - state ของจริงอยู่ที่ page */
  onChanged: () => void;
  /** header คีย์ LLM ที่ใช้อยู่ - ต้องใช้ตอน embed เอกสาร */
  llmHeaders: Record<string, string>;
  llmLabel: string;
  blocked: string | null;
}

export default function CompanyPanel({
  open, onClose, officeId, userId, profile, products, deptNotes, deptPublicNotes = {}, onChanged, llmHeaders, llmLabel, blocked,
}: Props) {
  const [pubNotes, setPubNotes] = useState<Record<string, string>>({});
  const [tab, setTab] = useState('profile');
  const [canEdit, setCanEdit] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [items, setItems] = useState<Product[]>([]);
  const [noteDept, setNoteDept] = useState(DEPARTMENTS[0].id);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // เอกสาร
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [uploadDepts, setUploadDepts] = useState<string[]>([]);
  /** ลูกค้าที่ถามผ่าน LINE/ช่องทางสาธารณะเห็นเอกสารนี้ได้ไหม - ค่าเริ่มต้นภายใน ต้องตั้งใจเปิด */
  const [uploadPublic, setUploadPublic] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [pasteName, setPasteName] = useState('');
  const [pasteText, setPasteText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // เปิดมาแล้วเอาค่าจริงมาเป็นร่าง - แก้ในร่างจนกว่าจะกดบันทึก
  useEffect(() => {
    if (!open) return;
    setDraft({ ...profile });
    setNotes({ ...deptNotes });
    setPubNotes({ ...deptPublicNotes });
    setItems(products.map((p) => ({ ...p })));
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
      setMsg({ ok: true, text: t('บันทึกโปรไฟล์แล้ว - agent ทุกตัวจะเห็นในคำถามถัดไป') });
    } catch (e) {
      setMsg({ ok: false, text: sbError(e) });
    } finally {
      setSaving(false);
    }
  };

  // แถวเปล่าที่ผู้ใช้กด "เพิ่ม" แล้วไม่ได้กรอกอะไรเลย ไม่นับเป็นความผิด แค่ไม่บันทึก
  const isBlank = (p: Product) => !p.name.trim() && !p.description.trim() && !p.price.trim() && !p.note.trim();
  const filledItems = items.filter((p) => !isBlank(p));
  const productProblem = filledItems.map(productIssue).find(Boolean) ?? null;
  const productsDirty = JSON.stringify(filledItems) !== JSON.stringify(products);

  const doSaveProducts = async () => {
    if (!officeId) return;
    setSaving(true); setMsg(null);
    try {
      await saveProducts(officeId, filledItems, userId);
      onChanged();
      setItems(filledItems.map((p) => ({ ...p })));
      setMsg({ ok: true, text: t('บันทึกสินค้า {n} รายการแล้ว - agent ทุกตัวจะเห็นในคำถามถัดไป', { n: filledItems.length }) });
    } catch (e) {
      setMsg({ ok: false, text: sbError(e) });
    } finally {
      setSaving(false);
    }
  };

  const setItem = (id: string, patch: Partial<Product>) =>
    setItems((xs) => xs.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const moveItem = (id: string, dir: -1 | 1) =>
    setItems((xs) => {
      const i = xs.findIndex((p) => p.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= xs.length) return xs;
      const next = [...xs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const doSaveNote = async () => {
    if (!officeId) return;
    setSaving(true); setMsg(null);
    try {
      await saveDeptNote(officeId, noteDept, (notes[noteDept] ?? '').trim(), userId, (pubNotes[noteDept] ?? '').trim());
      onChanged();
      setMsg({ ok: true, text: t('บันทึกโน้ตของ{name}แล้ว', { name: t(DEPT_BY_ID.get(noteDept)?.nameTh ?? noteDept) }) });
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
    if (!text.trim()) { setMsg({ ok: false, text: t('ไฟล์ว่าง หรืออ่านเป็นข้อความไม่ได้') }); return; }
    setUploading(name); setMsg(null);
    let row: DocRow | null = null;
    try {
      row = await createDoc({
        office_id: officeId, name, dept_ids: uploadDepts, bytes: size, uploaded_by: userId,
        visibility: uploadPublic ? 'public' : 'internal',
      });
      setDocs((d) => [row!, ...d]);
      const res = await fetch('/api/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...llmHeaders },
        body: JSON.stringify({ document: text, officeId }),
      });
      const data = (await res.json()) as { texts?: string[]; vectors?: number[][]; model?: string; error?: string };
      if (!res.ok || !data.texts || !data.vectors || !data.model) throw new Error(data.error ?? `HTTP ${res.status}`);
      await insertChunks(data.texts.map((t, i) => ({
        doc_id: row!.id, office_id: officeId, seq: i, content: t, embedding: data.vectors![i], embed_model: data.model!,
      })));
      if (file) await uploadDocFile(officeId, row.id, file);
      await updateDoc(row.id, { status: 'ready', chunk_count: data.texts.length });
      setMsg({ ok: true, text: t('อัปโหลด "{name}" แล้ว {n} ชิ้น - agent จะค้นเจอตอนถามเรื่องที่เกี่ยว', { name, n: data.texts.length }) });
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
      setMsg({ ok: false, text: t('ตอนนี้รับเฉพาะไฟล์ข้อความ (.txt .md .csv .json) - PDF/Word ให้แปลงเป็นข้อความก่อน หรือวางข้อความในช่องด้านล่าง') });
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
        title={t('ข้อมูลบริษัท')}
        description={t('สิ่งที่ agent ทุกตัวอ่านก่อนตอบ - ทำให้คำตอบเป็นเรื่องของบริษัทเรา ไม่ใช่บริษัทไหนก็ได้')}
        wide
      >
        {blocked ? (
          <p className="rounded-box border-2 border-wood-dark bg-wood-deep/60 px-2 py-1.5 text-[11px] leading-relaxed text-brass-lite">{blocked}</p>
        ) : (
          <>
            {!canEdit && (
              <p className="flex items-center gap-1.5 rounded-box border border-ink-600 bg-ink-700 px-2 py-1 text-[11px] text-dim">
                <ShieldAlert className="size-3.5" /> {t('คุณอ่านได้อย่างเดียว - เจ้าของหรือ exec ของออฟฟิศเท่านั้นที่แก้ได้')}
              </p>
            )}
            <p className="flex items-start gap-1.5 rounded-box border border-dashed border-ink-500 px-2 py-1 text-[10px] leading-relaxed text-dim">
              <ShieldAlert className="mt-px size-3 shrink-0 text-brass" />
              <span className="flex flex-wrap items-center gap-1.5">
                {t('ข้อมูลนี้ถูกส่งไปที่')} <b className="text-parchment">{llmLabel}</b> {t('ทุกคำถาม - อย่าใส่รหัสผ่าน เลขบัตร หรือข้อมูลลับ')}
                <InfoTip>
                  {t('ทุกฟิลด์ในหน้านี้ถูกแนบไปกับทุกคำถามที่ส่งถึงผู้ให้บริการโมเดล จึงไม่ควรใส่รหัสผ่าน เลขบัตร หรือข้อมูลที่ห้ามออกนอกบริษัท Ollama ในเครื่องปลอดภัยที่สุด ส่วน free tier ของบางผู้ให้บริการอาจนำข้อมูลไปฝึกโมเดล')}
                </InfoTip>
              </span>
            </p>

            <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-col">
              <TabsList className="rounded-t-box border border-b-0 border-wood-deep">
                <TabsTrigger value="profile"><BookOpen /> {t('โปรไฟล์')}</TabsTrigger>
                <TabsTrigger value="products"><Package /> {t('สินค้า')}{products.length ? ` ${products.length}` : ''}</TabsTrigger>
                <TabsTrigger value="depts">{t('แผนก')}</TabsTrigger>
                <TabsTrigger value="docs"><FileText /> {t('เอกสาร')}{docs.length ? ` ${docs.length}` : ''}</TabsTrigger>
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
                            {t(f.label)}
                            {/* ชั้นข้อมูล - ลูกค้าที่ถามผ่าน LINE/ช่องทางสาธารณะเห็นเฉพาะฟิลด์ที่ติดป้ายนี้ */}
                            {f.public
                              ? <Badge variant="brass" title={t('ลูกค้าที่ถามผ่านช่องทางสาธารณะเห็นได้')}>{t('ลูกค้าเห็น')}</Badge>
                              : <Badge title={t('เฉพาะคนในและ agent ภายใน')}>{t('ภายใน')}</Badge>}
                            <span className={`ml-auto text-[10px] font-normal ${over ? 'text-brass' : 'text-dim'}`}>{v.length}/{f.max}</span>
                          </span>
                        }
                        info={t(f.hint)}
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
                    {t('รวม {n}/{max} ตัวอักษร', { n: total.toLocaleString(), max: PROFILE_MAX_TOTAL.toLocaleString() })}
                    {overTotal && t(' - ยาวเกิน จะถูกส่งทุกคอล ตัดให้สั้นลงก่อน')}
                  </span>
                  <Button variant="primary" className="ml-auto" disabled={!canEdit || saving || overTotal} onClick={doSaveProfile}>
                    {saving ? <LoaderCircle className="animate-spin" /> : <Save />} {t('บันทึกโปรไฟล์')}
                  </Button>
                </div>
              </TabsContent>

              {/* ---------- สินค้า/บริการ ---------- */}
              <TabsContent value="products" className="min-h-0">
                <div className="flex max-h-[56vh] flex-col gap-2 overflow-y-auto rounded-b-box border border-t-0 border-ink-600 bg-ink-800 p-2.5">
                  <Hint className="flex items-center gap-1.5">
                    {t('รายการสินค้า/บริการที่ agent ใช้อ้างอิง')}
                    <InfoTip>
                      {t('รายการนี้ถูกส่งให้ agent ทุกตัวพร้อมโปรไฟล์ ควรใส่ชื่อและราคาให้ตรงของจริง agent จะอ้างตามนี้และไม่แต่งราคาเอง ราคาพิมพ์เป็นข้อความได้ เช่น "990-2,990 บาท/เดือน" หรือ "เริ่มต้น 15,000 บาท/โปรเจกต์"')}
                    </InfoTip>
                  </Hint>

                  {!items.length ? (
                    <Hint className="py-2 text-center">{t('ยังไม่มีสินค้า - กด "เพิ่มสินค้า" ด้านล่าง')}</Hint>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {items.map((p, i) => {
                        const issue = productIssue(p);
                        const blank = isBlank(p);
                        return (
                          <li key={p.id} className={`flex flex-col gap-1.5 rounded-box border bg-ink-700 p-2 ${issue && !blank ? 'border-brass/60' : 'border-ink-600'}`}>
                            <div className="flex items-center gap-1.5">
                              <span className="w-5 shrink-0 text-center text-[10px] text-dim">{i + 1}</span>
                              <Input
                                value={p.name}
                                disabled={!canEdit}
                                maxLength={PRODUCT_LIMITS.name}
                                onChange={(e) => setItem(p.id, { name: e.target.value })}
                                placeholder={t('ชื่อสินค้า/บริการ *')}
                                className="min-w-0 flex-1 font-semibold"
                              />
                              <Input
                                value={p.price}
                                disabled={!canEdit}
                                maxLength={PRODUCT_LIMITS.price}
                                onChange={(e) => setItem(p.id, { price: e.target.value })}
                                placeholder={t('ราคา')}
                                className="w-40 shrink-0"
                              />
                              {canEdit && (
                                <>
                                  <Button size="icon" variant="ghost" className="size-7" title={t('เลื่อนขึ้น')} disabled={i === 0} onClick={() => moveItem(p.id, -1)}><ArrowUp /></Button>
                                  <Button size="icon" variant="ghost" className="size-7" title={t('เลื่อนลง')} disabled={i === items.length - 1} onClick={() => moveItem(p.id, 1)}><ArrowDown /></Button>
                                  <Button size="icon" variant="ghost" className="size-7" title={t('ลบรายการนี้')} onClick={() => setItems((xs) => xs.filter((x) => x.id !== p.id))}><Trash2 /></Button>
                                </>
                              )}
                            </div>
                            <div className="flex gap-1.5 pl-6">
                              <Textarea
                                rows={2}
                                value={p.description}
                                disabled={!canEdit}
                                maxLength={PRODUCT_LIMITS.description}
                                onChange={(e) => setItem(p.id, { description: e.target.value })}
                                placeholder={t('รายละเอียด - ทำอะไร ให้ใคร จุดขาย')}
                                className="h-auto min-w-0 flex-1 text-[11px]"
                              />
                              <Textarea
                                rows={2}
                                value={p.note}
                                disabled={!canEdit}
                                maxLength={PRODUCT_LIMITS.note}
                                onChange={(e) => setItem(p.id, { note: e.target.value })}
                                placeholder={t('หมายเหตุ (ภายใน - ลูกค้าไม่เห็น) ต้นทุน/มาร์จิน เงื่อนไข สถานะ')}
                                className="h-auto w-56 shrink-0 text-[11px]"
                              />
                            </div>
                            {issue && !blank && <span className="pl-6 text-[10px] text-brass">{t(issue)}</span>}
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {canEdit && (
                    <Button
                      variant="outline" size="sm" className="self-start"
                      disabled={items.length >= PRODUCT_MAX_COUNT}
                      onClick={() => setItems((xs) => [...xs, emptyProduct(crypto.randomUUID())])}
                    >
                      <Plus /> {t('เพิ่มสินค้า')}{items.length >= PRODUCT_MAX_COUNT ? t(' (เต็ม {n} รายการ)', { n: PRODUCT_MAX_COUNT }) : ''}
                    </Button>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className={`text-[11px] ${productProblem ? 'text-brass' : 'text-dim'}`}>
                    {productProblem ? t(productProblem) : t('{n}/{max} รายการ', { n: filledItems.length, max: PRODUCT_MAX_COUNT })}
                  </span>
                  <Button variant="primary" className="ml-auto" disabled={!canEdit || saving || !!productProblem || !productsDirty} onClick={doSaveProducts}>
                    {saving ? <LoaderCircle className="animate-spin" /> : <Save />} {t('บันทึกรายการสินค้า')}
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
                          {t(d.shortTh)}
                          {has && <Check className="size-3 text-carpet-lite" />}
                        </button>
                      );
                    })}
                  </div>
                  <Field
                    label={
                      <span className="flex items-center gap-2">
                        {t('ข้อมูลภายในของ{name}', { name: t(DEPT_BY_ID.get(noteDept)?.nameTh ?? '') })}
                        <span className={`ml-auto text-[10px] font-normal ${(notes[noteDept] ?? '').length > DEPT_NOTE_MAX ? 'text-brass' : 'text-dim'}`}>
                          {(notes[noteDept] ?? '').length}/{DEPT_NOTE_MAX}
                        </span>
                      </span>
                    }
                    info={t('เฉพาะคนของแผนกนี้ที่จะเห็น ควรมี: {hint}', { hint: t(DEPT_NOTE_HINTS[noteDept] ?? '') })}
                  >
                    <Textarea
                      rows={7}
                      value={notes[noteDept] ?? ''}
                      disabled={!canEdit}
                      onChange={(e) => setNotes((n) => ({ ...n, [noteDept]: e.target.value }))}
                      className="h-auto font-mono text-[12px]"
                      placeholder={t('เขียนเป็นข้อ ๆ ได้เลย ไม่ต้องสวย - agent อ่านได้')}
                    />
                  </Field>
                  <Field
                    className="mt-2"
                    label={
                      <span className="flex items-center gap-2">
                        {t('ข้อมูลที่ตอบลูกค้าได้')} <Badge variant="brass">{t('ลูกค้าเห็น')}</Badge>
                        <span className={`ml-auto text-[10px] font-normal ${(pubNotes[noteDept] ?? '').length > DEPT_NOTE_MAX ? 'text-brass' : 'text-dim'}`}>
                          {(pubNotes[noteDept] ?? '').length}/{DEPT_NOTE_MAX}
                        </span>
                      </span>
                    }
                    info={t('ลูกค้าที่ทักมาทาง LINE/ช่องทางสาธารณะจะได้คำตอบจากตรงนี้ (และโปรไฟล์/สินค้า/เอกสารสาธารณะ) เท่านั้น - โน้ตภายในด้านบนไม่ออกไปหาลูกค้า · ใส่คำถามที่ลูกค้าถามบ่อยพร้อมคำตอบมาตรฐาน เวลาทำการ เงื่อนไข ช่องทางติดต่อ')}
                  >
                    <Textarea
                      rows={6}
                      value={pubNotes[noteDept] ?? ''}
                      disabled={!canEdit}
                      onChange={(e) => setPubNotes((n) => ({ ...n, [noteDept]: e.target.value }))}
                      className="h-auto font-mono text-[12px]"
                      placeholder={t('เช่น\nถาม: เปิดกี่โมง  ตอบ: จันทร์-ศุกร์ 9:00-18:00\nถาม: มีบริการอะไรบ้าง  ตอบ: ...')}
                    />
                  </Field>
                  <div className="mt-2 flex justify-end">
                    <Button variant="primary" disabled={!canEdit || saving || (notes[noteDept] ?? '').length > DEPT_NOTE_MAX || (pubNotes[noteDept] ?? '').length > DEPT_NOTE_MAX} onClick={doSaveNote}>
                      {saving ? <LoaderCircle className="animate-spin" /> : <Save />} {t('บันทึกโน้ตแผนกนี้')}
                    </Button>
                  </div>
                </div>
              </TabsContent>

              {/* ---------- เอกสาร ---------- */}
              <TabsContent value="docs" className="min-h-0">
                <div className="flex max-h-[56vh] flex-col gap-2 overflow-y-auto rounded-b-box border border-t-0 border-ink-600 bg-ink-800 p-2.5">
                  <Hint className="flex items-center gap-1.5">
                    {t('เอกสารอ้างอิงสำหรับ agent (ค้นด้วย embedding)')}
                    <InfoTip>
                      {t('เอกสารจะถูกตัดเป็นชิ้น แปลงเป็น vector ด้วย')} <b className="text-parchment">{llmLabel}</b> {t('แล้วเก็บใน Supabase ตอนถาม ระบบค้นชิ้นที่เกี่ยวข้องมาแนบให้ agent พร้อมอ้างอิงชื่อไฟล์ ต้องใช้คีย์ที่ทำ embedding ได้ (Gemini / OpenAI / Ollama ที่ pull nomic-embed-text แล้ว)')}
                    </InfoTip>
                  </Hint>

                  <Field label={t('ชั้นข้อมูล')} info={t('ภายใน = คนในและ agent ภายในเท่านั้น สาธารณะ = ลูกค้าที่ถามผ่าน LINE/ช่องทางสาธารณะให้ PR ค้นตอบได้ด้วย (เช่น โบรชัวร์ ราคา FAQ เงื่อนไขบริการ)')}>
                    <div className="flex gap-1">
                      <button onClick={() => setUploadPublic(false)} disabled={!canEdit}
                        className={`rounded-box border-2 px-2 py-0.5 text-[10px] ${!uploadPublic ? 'border-brass bg-ink-700 text-parchment' : 'border-ink-600 bg-ink-800 text-dim hover:border-ink-500'}`}>
                        {t('ภายใน')}
                      </button>
                      <button onClick={() => setUploadPublic(true)} disabled={!canEdit}
                        className={`rounded-box border-2 px-2 py-0.5 text-[10px] ${uploadPublic ? 'border-brass bg-brass/20 text-brass' : 'border-ink-600 bg-ink-800 text-dim hover:border-ink-500'}`}>
                        {t('สาธารณะ - ลูกค้าเห็นได้')}
                      </button>
                    </div>
                  </Field>

                  <Field label={t('ให้แผนกไหนอ่านได้')} info={t('ไม่เลือก = ทุกแผนก เลือกเฉพาะแผนกที่เกี่ยวข้อง เช่น เอกสารกฎหมายเลือกเฉพาะแผนกกฎหมาย')}>
                    <div className="flex flex-wrap gap-1">
                      {DEPARTMENTS.map((d) => {
                        const on = uploadDepts.includes(d.id);
                        return (
                          <button key={d.id} onClick={() => toggleDept(d.id)} disabled={!canEdit}
                            className={`flex items-center gap-1 rounded-box border-2 px-1.5 py-0.5 text-[10px] ${on ? 'border-carpet bg-carpet-dark text-white' : 'border-ink-600 bg-ink-800 text-dim hover:border-ink-500'}`}>
                            <i className="size-2 rounded-[2px]" style={{ background: d.color }} />{t(d.shortTh)}
                          </button>
                        );
                      })}
                    </div>
                  </Field>

                  <div className="flex flex-wrap items-center gap-2">
                    <input ref={fileRef} type="file" accept=".txt,.md,.markdown,.csv,.json" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} />
                    <Button variant="outline" size="sm" disabled={!canEdit || !!uploading} onClick={() => fileRef.current?.click()}>
                      {uploading ? <LoaderCircle className="animate-spin" /> : <Upload />} {uploading ? t('กำลังอ่าน {name}', { name: uploading }) : t('อัปโหลดไฟล์ข้อความ')}
                    </Button>
                    <span className="text-[10px] text-dim">{t('.txt .md .csv .json - PDF/Word แปลงเป็นข้อความก่อน')}</span>
                  </div>

                  <details className="rounded-box border border-ink-600 bg-ink-700 p-2">
                    <summary className="cursor-pointer text-[11px] text-dim hover:text-parchment">{t('หรือวางข้อความตรงนี้')}</summary>
                    <div className="mt-2 flex flex-col gap-1.5">
                      <Input value={pasteName} onChange={(e) => setPasteName(e.target.value)} placeholder={t('ตั้งชื่อเอกสาร เช่น คู่มือพนักงาน 2569')} disabled={!canEdit} />
                      <Textarea rows={6} value={pasteText} onChange={(e) => setPasteText(e.target.value)} className="h-auto font-mono text-[11px]" placeholder={t('วางข้อความทั้งก้อน')} disabled={!canEdit} />
                      <Button variant="primary" size="sm" className="self-end"
                        disabled={!canEdit || !!uploading || !pasteName.trim() || !pasteText.trim()}
                        onClick={async () => { await ingest(`${pasteName.trim()}.txt`, pasteText, pasteText.length); setPasteName(''); setPasteText(''); }}>
                        <Upload /> {t('เพิ่มเป็นเอกสาร')}
                      </Button>
                    </div>
                  </details>

                  {docsLoading && !docs.length ? (
                    <Hint className="py-2 text-center"><LoaderCircle className="inline size-3 animate-spin" /> {t('กำลังโหลดรายการ')}</Hint>
                  ) : !docs.length ? (
                    <Hint className="py-2 text-center">{t('ยังไม่มีเอกสาร')}</Hint>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {docs.map((d) => (
                        <li key={d.id} className="flex items-center gap-2 rounded-box border border-ink-600 bg-ink-700 px-2 py-1.5">
                          <FileText className="size-4 shrink-0 text-dim" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12px] font-semibold text-parchment">{d.name}</span>
                            <span className="flex flex-wrap items-center gap-1.5 text-[10px] text-dim">
                              {d.status === 'ready' && <Badge variant="good">{t('{n} ชิ้น', { n: d.chunk_count })}</Badge>}
                              {d.status === 'processing' && <Badge variant="brass">{t('กำลังประมวลผล')}</Badge>}
                              {d.status === 'error' && <Badge variant="bad" title={d.error ?? ''}>{t('พัง')} - {d.error?.slice(0, 60)}</Badge>}
                              {d.visibility === 'public' && <Badge variant="brass">{t('สาธารณะ')}</Badge>}
                              {d.dept_ids.length ? d.dept_ids.map((id) => t(DEPT_BY_ID.get(id)?.shortTh ?? id)).join(', ') : t('ทุกแผนก')}
                              <span>· {(d.bytes / 1024).toFixed(1)} KB</span>
                            </span>
                          </span>
                          {canEdit && (
                            <Button size="icon" variant="ghost" className="size-7" title={t('ลบเอกสารนี้')}
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
