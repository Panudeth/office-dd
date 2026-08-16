'use client';

import { Building2, LogOut, Plug, Plus } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import {
  createOffice, healthCheck, listOffices, sb, sbError, supabaseConfigured,
  usingSecretKeyByMistake, type Office, type User,
} from '@/lib/supabase';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Hint } from '@/components/ui/panel';

interface Props {
  open: boolean;
  onClose: () => void;
  user: User | null;
  office: Office | null;
  onUser: (u: User | null) => void;
  onOffice: (o: Office | null) => void;
}

export default function OfficePanel({
  open, onClose, user, office, onUser, onOffice,
}: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [offices, setOffices] = useState<Office[]>([]);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!open || !user) return;
    listOffices()
      .then(setOffices)
      .catch((e) => setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }));
  }, [open, user]);

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
      if (data.user && data.session) {
        onUser(data.user);
        setMsg({ ok: true, text: mode === 'up' ? 'สมัครและเข้าสู่ระบบแล้ว' : 'เข้าสู่ระบบแล้ว' });
      } else {
        setMsg({ ok: true, text: 'สมัครแล้ว เช็คอีเมลเพื่อยืนยันก่อนเข้าสู่ระบบ' });
      }
    } catch (err) {
      setMsg({ ok: false, text: sbError(err) });
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await sb()?.auth.signOut();
    onUser(null);
    onOffice(null);
    setOffices([]);
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
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
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
        ) : !user ? (
          <form onSubmit={auth} className="flex flex-col gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
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
            <Hint className="-mt-2">
              กดก่อนสมัครได้ จะได้รู้ว่ารัน schema.sql แล้วหรือยัง
            </Hint>

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
          </form>
        ) : (
          <>
            <div className="flex items-center gap-2 rounded-box border border-ink-600 bg-ink-700 px-2 py-1.5">
              <span className="truncate text-[12px] text-parchment">{user.email}</span>
              <Button variant="ghost" size="sm" className="ml-auto shrink-0" onClick={signOut}>
                <LogOut /> ออกจากระบบ
              </Button>
            </div>

            <Field label="เลือกออฟฟิศ">
              {offices.length === 0 ? (
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
