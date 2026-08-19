'use client';

import {
  Armchair, Building2, Check, Flower2, Image as ImageIcon, LoaderCircle, MousePointer2, PaintBucket, PackagePlus, RotateCw, Sofa, Trash2, TreePine, Undo2, Wrench,
} from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import FurnThumb, { TileThumb } from '@/components/FurnThumb';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InfoTip } from '@/components/ui/infotip';
import { Input } from '@/components/ui/input';
import { Hint, PanelBody } from '@/components/ui/panel';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { CATEGORIES, CATEGORY_TH, FURN, MAX_SIGN_TEXT, TILES, type FurnCategory, type FurnKind } from '@/game/furniture';
import { SECRETARY_NAME } from '@/game/map';
import type { EmployeeSnapshot } from '@/game/types';
import type { EditSnapshot, World } from '@/game/world';
import { DEPARTMENTS, DEPT_BY_ID } from '@/lib/departments';

/* ============================================================
   แท็บ "จัดออฟฟิศ" ในแผงขวา - เปิดแท็บนี้ = เข้าโหมดจัดบนแผนที่
   การลาก/หมุน/วาง/ระบายเกิดบน canvas (world) แท็บนี้แสดงสถานะ + ให้ปุ่มสำหรับสิ่งที่คลิกบนแผนที่ไม่ได้
   (หยิบของใหม่ - มีรูปให้ดู, จานสีพื้น/ผนัง, เลือกคนนั่ง, โลโก้บริษัท, ลบ, คืนค่าเริ่มต้น)
   ============================================================ */

export type LayoutSaveState = 'idle' | 'saving' | 'saved' | 'error';

interface Props {
  world: World | null;
  snap: EditSnapshot;
  roster: EmployeeSnapshot[];
  save: LayoutSaveState;
  saveErr: string | null;
}

const NONE = '__none__';
type Tab = FurnCategory | 'paint';
const TABS: { id: Tab; label: string; icon: typeof Armchair }[] = [
  ...CATEGORIES.map((c) => ({
    id: c as Tab, label: CATEGORY_TH[c],
    icon: ({ office: Building2, work: Wrench, lounge: Sofa, decor: Armchair, wall: ImageIcon, floor: Flower2, garden: TreePine } as Record<FurnCategory, typeof Armchair>)[c],
  })),
  { id: 'paint', label: 'พื้น/ผนัง', icon: PaintBucket },
];
const DIR_TH = { up: 'หันขึ้น', down: 'หันลง', left: 'หันซ้าย', right: 'หันขวา' } as const;

/** ย่อรูปโลโก้ให้พอดีตรา 8x2 ช่อง (128x32 px) x2 เพื่อความคม - คืน data URL png */
async function shrinkLogo(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('อ่านรูปไม่ได้')); i.src = url; });
    // ตัดขอบโปร่ง/ขาวรอบโลโก้ออกก่อน - รูปโลโก้ส่วนใหญ่มีขอบว่างเยอะ ถ้าไม่ตัด พอย่อลงป้ายจะเหลือนิดเดียว
    const src = document.createElement('canvas'); src.width = img.naturalWidth; src.height = img.naturalHeight;
    const sg = src.getContext('2d')!; sg.drawImage(img, 0, 0);
    const d = sg.getImageData(0, 0, src.width, src.height).data;
    let x0 = src.width, y0 = src.height, x1 = -1, y1 = -1;
    for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4;
      const a = d[i + 3];
      const white = d[i] > 245 && d[i + 1] > 245 && d[i + 2] > 245;
      if (a > 16 && !white) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) { x0 = 0; y0 = 0; x1 = src.width - 1; y1 = src.height - 1; } // รูปขาว/โปร่งทั้งใบ - ใช้ทั้งรูป
    const pad = 2;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(src.width - 1, x1 + pad); y1 = Math.min(src.height - 1, y1 + pad);
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const W = 256, H = 96;
    const k = Math.min(W / cw, H / ch, 1);
    const w = Math.max(1, Math.round(cw * k)), h = Math.max(1, Math.round(ch * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(src, x0, y0, cw, ch, 0, 0, w, h);
    return c.toDataURL('image/png');
  } finally { URL.revokeObjectURL(url); }
}

export default function LayoutPanel({ world, snap, roster, save, saveErr }: Props) {
  const [tab, setTab] = useState<Tab>('work');
  const [confirmReset, setConfirmReset] = useState(false);
  const [logoErr, setLogoErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const sel = snap.selected;
  const kinds = tab === 'paint' ? [] : (Object.keys(FURN) as FurnKind[]).filter((k) => FURN[k].category === tab);
  const people = [
    { id: 'boss', label: 'คุณ · ผู้บริหาร' },
    { id: 'secretary', label: `${SECRETARY_NAME} · เลขาฯ` },
    ...roster.map((r) => ({ id: r.id, label: `${r.name} · ${DEPT_BY_ID.get(r.deptId)?.shortTh ?? r.deptId}` })),
  ];
  const ownerName = sel?.owner ? people.find((p) => p.id === sel.owner)?.label ?? null : null;

  if (!world) return <PanelBody><Hint>กำลังโหลดแผนที่...</Hint></PanelBody>;

  const onLogo = async (ev: ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    ev.target.value = '';
    if (!f) return;
    setLogoErr(null);
    try {
      const url = await shrinkLogo(f);
      if (url.length > 60_000) { setLogoErr('รูปซับซ้อนเกินไป (ไฟล์หลังย่อยังใหญ่) - ลองรูปที่พื้นหลังเรียบหรือเล็กลง'); return; }
      world.setLogo(url);
    } catch (e) { setLogoErr(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <PanelBody className="gap-2 overflow-y-auto pr-1.5">
      <div className="flex items-center gap-1.5 text-[11px]">
        <span className="text-dim">{snap.itemCount} ชิ้น</span>
        <span className="flex-1" />
        <span className="flex items-center gap-1 text-[10px] text-dim">
          {save === 'saving' && <><LoaderCircle className="size-3 animate-spin" /> บันทึก...</>}
          {save === 'saved' && <><Check className="size-3 text-carpet-lite" /> บันทึกแล้ว</>}
          {save === 'error' && <span className="text-rug-lite" title={saveErr ?? ''}>บันทึกไม่สำเร็จ</span>}
        </span>
        {!snap.on && (
          <Button size="sm" variant="primary" className="h-6 px-2" onClick={() => world.setEditMode(true)}>
            <Wrench className="size-3" /> เริ่มจัด
          </Button>
        )}
      </div>

      <Hint className="flex items-center gap-1.5 text-[10px] leading-snug">
        คลิกเลือก · ลากย้าย · <kbd className="rounded bg-ink-700 px-1">R</kbd> หมุน · <kbd className="rounded bg-ink-700 px-1">Del</kbd> ลบ
        <InfoTip>
          โหมดเลือก: <b>คลิก</b>ของเพื่อเลือก (ของซ้อนกัน เช่นโต๊ะบนพรม คลิกซ้ำที่เดิมเพื่อวนเลือกชิ้นข้างล่าง) · <b>ลาก</b>ย้าย · <b>ดับเบิลคลิก</b>/<kbd className="rounded bg-ink-700 px-1">R</kbd> หมุน · <kbd className="rounded bg-ink-700 px-1">Del</kbd> ลบ · <kbd className="rounded bg-ink-700 px-1">Esc</kbd>/คลิกขวา ยกเลิก
          <br />เขียว = วางได้ / แดง = วางไม่ได้ (ทับของ ทับคน หรือทำให้เดินไปที่นั่ง/จุดสำคัญไม่ถึงจากทางเข้า)
        </InfoTip>
      </Hint>

      {/* แถบเครื่องมือ - โหมดปัจจุบันเห็นชัด กด "เลือก" กลับได้ทุกเมื่อ */}
      {snap.on && (
        <div className="flex items-center gap-1 rounded-box border-2 border-ink-600 bg-ink-800 p-1 text-[10px]">
          <Button size="sm" variant={snap.tool === 'select' ? 'primary' : 'outline'} className="h-7 flex-1 gap-1 px-1.5" onClick={() => world.editSelectTool()} title="คลิกของบนแผนที่เพื่อเลือก · ลากย้าย · ดับเบิลคลิก/R หมุน · Del ลบ">
            <MousePointer2 className="size-3" /> เลือก/ย้าย
          </Button>
          <Button size="sm" variant={snap.tool === 'place' ? 'primary' : 'outline'} className="h-7 flex-1 gap-1 px-1.5" disabled={snap.tool !== 'place'} title="หยิบของจากแคตตาล็อกด้านล่าง แล้วคลิกวางบนแผนที่">
            <PackagePlus className="size-3" /> {snap.tool === 'place' && snap.placing ? `วาง: ${FURN[snap.placing].label}` : 'วางของ (เลือกด้านล่าง)'}
          </Button>
          <Button size="sm" variant={snap.tool === 'paint' ? 'primary' : 'outline'} className="h-7 flex-1 gap-1 px-1.5" onClick={() => setTab('paint')} title="เลือกพื้น/ผนังจากจานสี แล้วลากระบาย">
            <PaintBucket className="size-3" /> {snap.tool === 'paint' && snap.painting ? `ระบาย: ${TILES.find((t) => t.code === snap.painting)?.label ?? ''}` : 'ระบายพื้น/ผนัง'}
          </Button>
        </div>
      )}
      {snap.on && snap.tool !== 'select' && (
        <Hint className="text-[10px]">อยู่ในโหมด{snap.tool === 'place' ? 'วางของ' : 'ระบาย'} - กด <b>เลือก/ย้าย</b>, <kbd className="rounded bg-ink-700 px-1">Esc</kbd> หรือ<b>คลิกขวา</b>บนแผนที่เพื่อกลับไปแก้ของที่วางแล้ว</Hint>
      )}

      {snap.message && (
        <div className="rounded-box border border-brass/60 bg-wood-deep/60 px-2 py-1 text-[11px] text-brass-lite">{snap.message}</div>
      )}

      {/* ชิ้นที่เลือก / กำลังถือ / กำลังระบาย */}
      <div className="rounded-box border-2 border-ink-600 bg-ink-800 p-2 text-[11px]">
        {sel ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <FurnThumb kind={sel.kind} dir={sel.dir ?? 'up'} size={4} className="shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-parchment">{sel.label}</div>
                {sel.dir && <Badge>{DIR_TH[sel.dir]}</Badge>}
              </div>
              {sel.rotates && (
                <Button size="sm" variant="outline" className="h-7 px-1.5" title="หมุน (R)" onClick={() => world.editRotate()}>
                  <RotateCw className="size-3" /> หมุน
                </Button>
              )}
              <Button
                size="sm" variant="danger" className="h-7 px-1.5" disabled={!sel.canDelete}
                title={sel.canDelete ? 'ลบ (Delete)' : sel.owner ? 'มีคนนั่งประจำ - เปลี่ยนคนนั่งเป็นว่างก่อน' : 'ชิ้นนี้ต้องมีเสมอ (ย้ายได้ ลบไม่ได้)'}
                onClick={() => world.editDelete()}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
            {sel.canOwn && (
              <div className="flex items-center gap-1.5">
                <span className="shrink-0 text-dim">คนนั่ง</span>
                <Select value={sel.owner ?? NONE} onValueChange={(v) => world.editAssignSeat(sel.id, v === NONE ? null : v)}>
                  <SelectTrigger className="h-7 flex-1 text-[11px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>ว่าง (ไม่มีคนประจำ)</SelectItem>
                    {people.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {sel.canOwn && ownerName && <Hint className="text-[10px]">เลือกคนอื่นจะสลับที่นั่งกับ {ownerName}</Hint>}
            {sel.signText && (
              <div className="flex items-center gap-1.5">
                <span className="shrink-0 text-dim">ข้อความ</span>
                <SignTextInput
                  key={sel.id}
                  value={sel.signText.value ?? ''}
                  placeholder={sel.signText.fallback}
                  onCommit={(t) => world.editSetSignText(t)}
                />
                {sel.signText.value !== null && (
                  <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" title="กลับไปใช้ชื่อย่อแผนก" onClick={() => world.editSetSignText('')}>รีเซ็ต</Button>
                )}
              </div>
            )}
            {sel.size && (
              <div className="flex items-center gap-1.5">
                <span className="shrink-0 text-dim">ขนาด</span>
                <Button size="sm" variant="outline" className="h-6 w-6 px-0" title="แคบลง ( [ )" disabled={sel.size.w <= sel.size.minW} onClick={() => world.editResize(-1, 0)}>-</Button>
                <span className="w-14 text-center tabular-nums">กว้าง {sel.size.w}</span>
                <Button size="sm" variant="outline" className="h-6 w-6 px-0" title="กว้างขึ้น ( ] )" disabled={sel.size.w >= sel.size.maxW} onClick={() => world.editResize(1, 0)}>+</Button>
                <Button size="sm" variant="outline" className="h-6 w-6 px-0" title="เตี้ยลง ( - )" disabled={sel.size.h <= sel.size.minH} onClick={() => world.editResize(0, -1)}>-</Button>
                <span className="w-12 text-center tabular-nums">สูง {sel.size.h}</span>
                <Button size="sm" variant="outline" className="h-6 w-6 px-0" title="สูงขึ้น ( = )" disabled={sel.size.h >= sel.size.maxH} onClick={() => world.editResize(0, 1)}>+</Button>
              </div>
            )}
            {sel.kind === 'logo' && <Hint className="text-[10px]">ลากเพื่อย้าย · รูปย่อให้พอดีกรอบโดยไม่บิดสัดส่วน · ยังไม่มีรูป? อัปโหลดด้านล่าง</Hint>}
            {sel.depth !== null && (
              <div className="flex items-center gap-1.5">
                <span className="shrink-0 text-dim">ระดับซ้อน</span>
                <span className="text-[10px] text-dim" title="0 = ตามความลึกจริง (แถวล่างทับแถวบน) · บวก = ดันมาข้างหน้า · ลบ = ดันไปข้างหลัง">{sel.depth > 0 ? `+${sel.depth}` : sel.depth} {sel.depth === 0 ? '(อัตโนมัติ)' : ''}</span>
                <span className="flex-1" />
                <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px]" disabled={sel.depth >= 3} onClick={() => world.editZ(1)}>ขึ้นหน้า</Button>
                <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px]" disabled={sel.depth <= -3} onClick={() => world.editZ(-1)}>ลงหลัง</Button>
                {sel.depth !== 0 && <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => world.editZReset()} title="กลับเป็นอัตโนมัติ">รีเซ็ต</Button>}
              </div>
            )}
            {sel.zOrder && (
              <div className="flex items-center gap-1.5">
                <span className="shrink-0 text-dim">ลำดับซ้อน</span>
                <span className="text-[10px] text-dim">ชั้นที่ {sel.zOrder.index + 1}/{sel.zOrder.total}</span>
                <span className="flex-1" />
                <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px]" disabled={sel.zOrder.index >= sel.zOrder.total - 1} onClick={() => world.editZ(1)}>ขึ้นหน้า</Button>
                <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px]" disabled={sel.zOrder.index <= 0} onClick={() => world.editZ(-1)}>ลงหลัง</Button>
                <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" disabled={sel.zOrder.index >= sel.zOrder.total - 1} onClick={() => world.editZ('top')}>บนสุด</Button>
                <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" disabled={sel.zOrder.index <= 0} onClick={() => world.editZ('bottom')}>ล่างสุด</Button>
              </div>
            )}
          </div>
        ) : snap.placing ? (
          <div className="flex items-center gap-2">
            <FurnThumb kind={snap.placing} size={4} className="shrink-0" />
            <span className="flex-1">กำลังถือ <b>{FURN[snap.placing].label}</b> - คลิกบนแผนที่เพื่อวาง{FURN[snap.placing].rotates ? ' (R หมุนก่อนวางได้)' : ''}</span>
            <Button size="sm" variant="outline" className="h-7 px-1.5" onClick={() => world.editCancel()}>ยกเลิก</Button>
          </div>
        ) : snap.painting ? (
          <div className="flex items-center gap-2">
            <TileThumb code={snap.painting} size={3} className="shrink-0" />
            <span className="flex-1">กำลังระบาย <b>{TILES.find((t) => t.code === snap.painting)?.label}</b> - ลากบนแผนที่</span>
            <Button size="sm" variant="outline" className="h-7 px-1.5" onClick={() => world.editCancel()}>เลิก</Button>
          </div>
        ) : (
          <Hint>{snap.on ? 'คลิกของบนแผนที่เพื่อเลือก - หรือหยิบของใหม่/จานสีด้านล่าง' : 'กด "เริ่มจัด" แล้วคลิกของบนแผนที่ - หรือหยิบของใหม่ด้านล่าง'}</Hint>
        )}
      </div>

      {/* หยิบของใหม่ / จานสี */}
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <Button key={t.id} size="sm" variant={tab === t.id ? 'primary' : 'outline'} className="h-6 gap-1 px-1.5 text-[10px]" onClick={() => setTab(t.id)}>
                <Icon className="size-3" /> {t.label}
              </Button>
            );
          })}
        </div>
        {tab === 'paint' ? (
          <>
          <Hint className="flex items-center gap-1.5 text-[10px] leading-snug">
            กั้นห้อง / รื้อกำแพง
            <InfoTip>
              <b>กั้นห้อง/สร้างกำแพงข้างใน</b>: เลือก &quot;ผนัง&quot; หรือ &quot;ผนังกระจก&quot; แล้ว<b>ลาก</b>บนพื้นเป็นเส้น · <b>รื้อกำแพง/เจาะประตู</b>: เลือกพื้นชนิดใดก็ได้แล้วระบายทับผนัง
              · ระบบไม่ให้กั้นจนที่นั่ง/จุดสำคัญเดินไม่ถึง (จะขึ้นข้อความแจ้ง)
            </InfoTip>
          </Hint>
          <div className="grid grid-cols-4 gap-1">
            {TILES.map((t) => (
              <button
                key={t.code} type="button" title={t.label}
                onClick={() => { if (!snap.on) world.setEditMode(true); world.editStartPaint(t.code); }}
                className={`flex flex-col items-center gap-0.5 rounded-box border-2 p-1 text-[10px] leading-tight transition-colors ${
                  snap.painting === t.code ? 'border-carpet bg-[#22401f] text-carpet-lite' : 'border-ink-600 bg-ink-800 text-parchment-2 hover:border-brass/60 hover:bg-ink-700'
                }`}
              >
                <TileThumb code={t.code} size={3} />
                <span className="line-clamp-2 text-center">{t.label}</span>
              </button>
            ))}
          </div>
          </>
        ) : (
          <div className="grid grid-cols-3 gap-1">
            {tab === 'office' && ([['#', 'กำแพงกั้นห้อง (ลากระบาย)'], ['G', 'ผนังกระจก (ลากระบาย)']] as const).map(([code, label]) => (
              <button
                key={code} type="button" title={`${label} - ระบายพื้นทับเพื่อรื้อ`}
                onClick={() => { if (!snap.on) world.setEditMode(true); world.editStartPaint(code); }}
                className={`flex flex-col items-center gap-0.5 rounded-box border-2 p-1 text-[10px] leading-tight transition-colors ${
                  snap.painting === code ? 'border-carpet bg-[#22401f] text-carpet-lite' : 'border-brass/40 bg-ink-800 text-parchment-2 hover:border-brass/60 hover:bg-ink-700'
                }`}
              >
                <span className="flex h-11 items-end justify-center overflow-hidden"><TileThumb code={code} size={3} /></span>
                <span className="line-clamp-2 text-center">{label}</span>
              </button>
            ))}
            {kinds.flatMap((k): { k: FurnKind; dept?: string; label: string }[] => (k === 'deptsign'
              ? DEPARTMENTS.map((d) => ({ k, dept: d.id, label: `ป้าย ${d.shortTh}` }))
              : [{ k, label: FURN[k].label }]
            )).map(({ k, dept, label }) => (
              <button
                key={k + (dept ?? '')} type="button" title={label}
                onClick={() => { if (!snap.on) world.setEditMode(true); world.editStartPlace(k, dept ? { dept } : {}); }}
                className={`flex flex-col items-center gap-0.5 rounded-box border-2 p-1 text-[10px] leading-tight transition-colors ${
                  snap.placing === k && !dept ? 'border-carpet bg-[#22401f] text-carpet-lite' : 'border-ink-600 bg-ink-800 text-parchment-2 hover:border-brass/60 hover:bg-ink-700'
                }`}
              >
                <span className="flex h-11 items-end justify-center overflow-hidden"><FurnThumb kind={k} size={4} /></span>
                <span className="line-clamp-2 text-center">{label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* โลโก้บริษัท */}
      <div className="flex items-center gap-2 rounded-box border-2 border-ink-600 bg-ink-800 p-2 text-[11px]">
        <div className="flex h-9 w-[72px] shrink-0 items-center justify-center rounded-box border border-ink-600 bg-ink-900">
          {snap.logo ? <img src={snap.logo} alt="โลโก้" className="max-h-8 max-w-[68px]" style={{ imageRendering: 'auto' }} /> : <span className="text-[10px] text-dim">ไม่มีโลโก้</span>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-parchment">โลโก้บริษัท</div>
          <Hint className="text-[10px]">โชว์ที่แถบบน + บนป้าย/ตราทุกชิ้นในออฟฟิศ · PNG พื้นหลังโปร่งจะสวยสุด</Hint>
          {snap.logo && (
            <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
              <span className="text-dim">ใส่กรอบ:</span>
              {([['contain', 'พอดี'], ['cover', 'เต็มกรอบ (ตัดขอบ)'], ['stretch', 'ยืดเต็ม']] as const).map(([v, l]) => (
                <Button key={v} size="sm" variant={snap.logoFit === v ? 'primary' : 'outline'} className="h-6 px-1.5 text-[10px]" onClick={() => world.setLogoFit(v)}>{l}</Button>
              ))}
            </div>
          )}
          {snap.logo && (
            <div className="mt-1 flex flex-wrap gap-1">
              <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px]" title="กรอบทองติดผนัง ปรับกว้าง 1-8 สูง 1-2" onClick={() => { if (!snap.on) world.setEditMode(true); world.editStartPlace('wlogo'); }}>+ ป้ายติดผนัง</Button>
              <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px]" title="แผ่นป้ายบนเสา 2 ช่อง วางหน้าทางเข้า/สวน" onClick={() => { if (!snap.on) world.setEditMode(true); world.editStartPlace('logostand'); }}>+ ป้ายตั้งพื้น</Button>
              <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px]" title="โลโก้บนพื้น ปรับขนาดได้" onClick={() => { if (!snap.on) world.setEditMode(true); world.editStartPlace('logo'); }}>+ โลโก้บนพื้น</Button>
            </div>
          )}
          {logoErr && <div className="text-[10px] text-rug-lite">{logoErr}</div>}
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onLogo} />
        <Button size="sm" variant="outline" className="h-7 px-1.5" onClick={() => fileRef.current?.click()}><ImageIcon className="size-3" /> อัปโหลด</Button>
        {snap.logo && <Button size="sm" variant="ghost" className="h-7 px-1.5 text-dim" title="ลบโลโก้" onClick={() => world.setLogo(null)}><Trash2 className="size-3" /></Button>}
      </div>

      <div className="flex items-center gap-1.5 text-[10px]">
        {confirmReset ? (
          <>
            <span className="text-brass-lite">คืนผังเริ่มต้นทั้งหมด (พื้น ของ ที่นั่ง)? โลโก้ยังอยู่</span>
            <span className="flex-1" />
            <Button size="sm" variant="danger" className="h-6 px-1.5" onClick={() => { world.editReset(); setConfirmReset(false); }}>ยืนยัน</Button>
            <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => setConfirmReset(false)}>ไม่</Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] text-dim" onClick={() => setConfirmReset(true)}>
            <Undo2 className="size-3" /> คืนผังเริ่มต้น
          </Button>
        )}
      </div>
    </PanelBody>
  );
}

/** ช่องกรอกข้อความป้ายแผนก - พิมพ์แล้วบันทึกตอน blur/Enter (ไม่ยิงบันทึกทุกตัวอักษร) */
function SignTextInput({ value, placeholder, onCommit }: { value: string; placeholder: string; onCommit: (t: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const commit = () => { if (draft.trim() !== value) onCommit(draft); };
  return (
    <Input
      className="h-7 flex-1 px-2 py-0 text-[11px]"
      value={draft}
      placeholder={placeholder || 'ข้อความบนป้าย'}
      maxLength={MAX_SIGN_TEXT}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); }
        else if (e.key === 'Escape') { setDraft(value); (e.target as HTMLInputElement).blur(); }
      }}
    />
  );
}
