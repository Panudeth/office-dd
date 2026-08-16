'use client';

import { Building2, LoaderCircle, LogOut, Plug, Plus } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import {
  accountAvatar, accountName, createOffice, healthCheck, listOffices, sb, sbError,
  signInWithGoogle, signOut, supabaseConfigured, usingSecretKeyByMistake,
  type Office, type User,
} from '@/lib/supabase';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { GoogleMark } from '@/components/ui/google-mark';
import { Field, Input } from '@/components/ui/input';
import { Hint } from '@/components/ui/panel';

interface Props {
  open: boolean;
  onClose: () => void;
  user: User | null;
  /** false = ยังตอบไม่ได้ว่าล็อกอินอยู่ไหม ห้ามเดาว่า "ไม่" แล้วโชว์ฟอร์ม */
  authReady: boolean;
  office: Office | null;
  /** ผลของการพยายามล็อกอินรอบที่แล้วที่ล้มเหลว - ต้องเด่นกว่าข้อความอื่นในแผง */
  notice?: string | null;
  onOffice: (o: Office | null) => void;
}

export default function OfficePanel({
  open, onClose, user, authReady, office, notice, onOffice,
}: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [offices, setOffices] = useState<Office[]>([]);
  const [loadingOffices, setLoadingOffices] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // ผูกกับ user.id ไม่ใช่ตัว object เพราะ supabase สร้าง object ใหม่ทุกครั้งที่ต่ออายุ token
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!open || !userId) { setOffices([]); return; }
    let alive = true;
    setLoadingOffices(true);
    listOffices()
      .then((rows) => { if (alive) setOffices(rows); })
      .catch((e) => {
        if (alive) setMsg({ ok: false, text: sbError(e) });
      })
      .finally(() => { if (alive) setLoadingOffices(false); });
    return () => { alive = false; };
  }, [open, userId]);

  // ปิดแล้วเปิดใหม่ไม่ควรเจอข้อความค้างจากรอบก่อน และไม่ควรมีรหัสผ่านค้างในหน่วยความจำ
  useEffect(() => {
    if (!open) { setMsg(null); setPassword(''); }
  }, [open]);

  const auth = async (e: FormEvent) => {
    e.preventDefault();
    const c = sb();
    if (!c) return;
    setBusy(true);
    setMsg(null);
    try {
      const fn = mode === 'in' ? c.auth.signInWithPassword : c.auth.signUp;
      const { data, error } = await fn.call(c.auth, { email: email.trim(), password });
      if (error) throw error;
      // ไม่ต้อง setUser เอง onAuthStateChange ที่ page.tsx เป็นคนเดียวที่ประกาศสถานะนี้
      setPassword('');
      setMsg(
        data.session
          ? { ok: true, text: mode === 'up' ? 'สมัครและเข้าสู่ระบบแล้ว' : 'เข้าสู่ระบบแล้ว' }
          : { ok: true, text: 'สมัครแล้ว เช็คอีเมลเพื่อยืนยันก่อนเข้าสู่ระบบ' },
      );
    } catch (err) {
      setMsg({ ok: false, text: sbError(err) });
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setBusy(true);
    setMsg(null);
    try {
      // สำเร็จแล้วเบราว์เซอร์จะออกจากหน้านี้ไปเลย บรรทัดถัดไปจึงไม่ได้รัน
      await signInWithGoogle();
    } catch (err) {
      setMsg({ ok: false, text: sbError(err) });
      setBusy(false);
    }
  };

  const leave = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await signOut();
      onOffice(null);
      setOffices([]);
    } catch (err) {
      // ออกไม่สำเร็จแล้วเงียบคือแย่ที่สุด ผู้ใช้จะนึกว่าออกแล้วทั้งที่ session ยังอยู่
      setMsg({ ok: false, text: sbError(err) });
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!user || !newName.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const o = await createOffice(newName.trim(), user.id);
      setOffices((prev) => [...prev, o]);
      setNewName('');
      onOffice(o);
      onClose();
    } catch (err) {
      setMsg({ ok: false, text: sbError(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        icon={<Building2 />}
        title="ออฟฟิศของฉัน"
        description="เข้าสู่ระบบและเลือกออฟฟิศที่จะใช้"
      >
        {notice && (
          <p className="rounded-box border-2 border-wood-dark bg-wood-deep/60 px-2 py-1.5 text-[11px] leading-relaxed text-brass-lite">
            <b className="text-brass">เข้าสู่ระบบไม่สำเร็จ</b>
            <br />
            {notice}
          </p>
        )}

        {usingSecretKeyByMistake ? (
          <Hint className="text-brass">
            คีย์ที่ใส่มาเป็น <b>secret key</b> (<code>sb_secret_...</code>) อันนี้ข้าม RLS ได้ทั้งหมด
            และห้ามให้เบราว์เซอร์เห็นเด็ดขาด
            <br />
            <br />
            เปลี่ยนเป็น <b>publishable key</b> (<code>sb_publishable_...</code>) จาก Project Settings
            หน้า API keys แล้วรีสตาร์ท dev server
          </Hint>
        ) : !supabaseConfigured ? (
          <Hint>
            ยังไม่ได้ตั้งค่า Supabase ตอนนี้แอปทำงานแบบ{' '}
            <b className="text-parchment">ในเครื่องอย่างเดียว</b> จ้างพนักงานแล้วรีเฟรชจะหาย
            <br />
            <br />
            วิธีเปิดใช้
            <br />
            1. สร้างโปรเจกต์ที่ supabase.com
            <br />
            2. เอา <code>supabase/schema.sql</code> ไปรันใน SQL Editor
            <br />
            3. ใส่ <code>NEXT_PUBLIC_SUPABASE_URL</code> และ{' '}
            <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> ใน <code>.env.local</code>
            <br />
            4. รีสตาร์ท dev server
          </Hint>
        ) : !authReady ? (
          /* ยังไม่รู้ว่ามี session ไหม - โชว์ฟอร์มตอนนี้คือเชิญให้กดเข้าสู่ระบบซ้ำทั้งที่เข้าอยู่แล้ว */
          <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-dim">
            <LoaderCircle className="size-4 animate-spin" />
            กำลังตรวจสอบสถานะการเข้าสู่ระบบ
          </div>
        ) : !user ? (
          <form onSubmit={auth} className="flex flex-col gap-3">
            {/* Google มาก่อน เพราะกดทีเดียวจบ ไม่ต้องคิดรหัสผ่านใหม่ */}
            <Button
              type="button"
              variant="outline"
              size="lg"
              disabled={busy}
              onClick={google}
              className="border-ink-500 bg-parchment text-ink-900 hover:bg-white hover:text-ink-900"
            >
              <GoogleMark className="size-4" />
              เข้าสู่ระบบด้วย Google
            </Button>

            <div className="flex items-center gap-2">
              <span className="h-px flex-1 bg-ink-600" />
              <span className="text-[10px] uppercase tracking-wide text-dim">หรือใช้อีเมล</span>
              <span className="h-px flex-1 bg-ink-600" />
            </div>

            <Field label="อีเมล" hint="ต้องเป็นอีเมลจริง Supabase บล็อกโดเมนทดสอบอย่าง example.com">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </Field>

            <Field label="รหัสผ่าน">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
              />
            </Field>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setMode(mode === 'in' ? 'up' : 'in')}
              >
                {mode === 'in' ? 'ยังไม่มีบัญชี สมัคร' : 'มีบัญชีแล้ว เข้าสู่ระบบ'}
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                {mode === 'in' ? 'เข้าสู่ระบบ' : 'สมัคร'}
              </Button>
            </DialogFooter>

            <div className="mt-1 border-t border-ink-600 pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setMsg(await healthCheck());
                  setBusy(false);
                }}
              >
                <Plug />
                {busy ? 'กำลังตรวจ' : 'ตรวจการเชื่อมต่อ และตาราง'}
              </Button>
              <Hint className="text-center">
                กดก่อนสมัครได้ จะได้รู้ว่ารัน schema.sql แล้วหรือยัง
              </Hint>
            </div>
          </form>
        ) : (
          <>
            <div className="flex items-center gap-2 rounded-box border border-ink-600 bg-ink-700 px-2 py-1.5">
              {/* เข้าด้วย Google จะมีชื่อกับรูปติดมาใน user_metadata ใช้เลยจะได้รู้ว่าเป็นบัญชีไหน */}
              {accountAvatar(user) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={accountAvatar(user)!}
                  alt=""
                  className="size-5 shrink-0 rounded-box border border-ink-500"
                />
              )}
              <span className="min-w-0 flex-1 truncate text-[12px] text-parchment">
                {accountName(user)}
              </span>
              {user.app_metadata?.provider === 'google' && (
                <GoogleMark className="size-3 shrink-0" />
              )}
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                disabled={busy}
                onClick={leave}
              >
                <LogOut /> ออกจากระบบ
              </Button>
            </div>

            <Field label="เลือกออฟฟิศ">
              {loadingOffices ? (
                <Hint className="flex items-center gap-1.5">
                  <LoaderCircle className="size-3 animate-spin" /> กำลังโหลดออฟฟิศ
                </Hint>
              ) : offices.length === 0 ? (
                <Hint>ยังไม่มีออฟฟิศ สร้างอันแรกด้านล่าง</Hint>
              ) : (
                <ul className="flex flex-col gap-1">
                  {offices.map((o) => {
                    const active = office?.id === o.id;
                    return (
                      <li key={o.id}>
                        <button
                          onClick={() => {
                            onOffice(o);
                            onClose();
                          }}
                          className={`flex w-full items-center gap-2 rounded-box border-2 px-2 py-1.5 text-left text-[12px] ${
                            active
                              ? 'border-brass bg-ink-700'
                              : 'border-ink-600 bg-ink-800 hover:border-ink-500'
                          }`}
                        >
                          <b className="font-semibold text-parchment">{o.name}</b>
                          {o.owner_id === user.id && <Badge>เจ้าของ</Badge>}
                          {active && (
                            <Badge variant="brass" className="ml-auto">
                              กำลังใช้
                            </Badge>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Field>

            <Field label="สร้างออฟฟิศใหม่">
              <div className="flex gap-1.5">
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="เช่น OneDD HQ"
                  maxLength={80}
                />
                <Button
                  variant="primary"
                  className="shrink-0"
                  onClick={create}
                  disabled={busy || !newName.trim()}
                >
                  <Plus /> สร้าง
                </Button>
              </div>
            </Field>
          </>
        )}

        {msg && (
          <p
            className={`rounded-box border px-2 py-1.5 text-[11px] leading-relaxed ${
              msg.ok
                ? 'border-carpet-dark bg-[#22401f] text-carpet-lite'
                : 'border-wood-dark bg-wood-deep/60 text-brass-lite'
            }`}
          >
            {msg.text}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
