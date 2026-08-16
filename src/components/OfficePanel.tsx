'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  createOffice, listOffices, sb, sbError, supabaseConfigured,
  type Office, type User,
} from '@/lib/supabase';

interface Props {
  open: boolean;
  onClose: () => void;
  user: User | null;
  office: Office | null;
  onUser: (u: User | null) => void;
  onOffice: (o: Office | null) => void;
}

export default function OfficePanel({ open, onClose, user, office, onUser, onOffice }: Props) {
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

  if (!open) return null;

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
        setMsg({ ok: true, text: 'สมัครแล้ว — เช็คอีเมลเพื่อยืนยันก่อนเข้าสู่ระบบ' });
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
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="panel-head">
          <h2>🏢 ออฟฟิศของฉัน</h2>
          <button className="ghost" onClick={onClose}>✕</button>
        </header>

        {!supabaseConfigured ? (
          <p className="hint">
            ยังไม่ได้ตั้งค่า Supabase — ตอนนี้แอปทำงานแบบ <b>ในเครื่องอย่างเดียว</b>{' '}
            (จ้างพนักงานแล้วรีเฟรชจะหาย)
            <br /><br />
            วิธีเปิดใช้:
            <br />1. สร้างโปรเจกต์ที่ supabase.com
            <br />2. เอา <code>supabase/schema.sql</code> ไปรันใน SQL Editor
            <br />3. ใส่ <code>NEXT_PUBLIC_SUPABASE_URL</code> และ{' '}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> ใน <code>.env.local</code>
            <br />4. รีสตาร์ท dev server
          </p>
        ) : !user ? (
          <form onSubmit={auth}>
            <label className="field">
              <span>อีเมล</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </label>
            <label className="field">
              <span>รหัสผ่าน</span>
              <input
                type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                required minLength={6} autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
                {mode === 'in' ? 'ยังไม่มีบัญชี? สมัคร' : 'มีบัญชีแล้ว? เข้าสู่ระบบ'}
              </button>
              <button type="submit" className="primary" disabled={busy}>
                {busy ? '…' : mode === 'in' ? 'เข้าสู่ระบบ' : 'สมัคร'}
              </button>
            </div>
          </form>
        ) : (
          <>
            <p className="hint">
              เข้าสู่ระบบเป็น <b>{user.email}</b>
              <button className="toggle" style={{ marginLeft: 8 }} onClick={signOut}>ออกจากระบบ</button>
            </p>

            <div className="field">
              <span>เลือกออฟฟิศ</span>
              {offices.length === 0 ? (
                <small>ยังไม่มีออฟฟิศ — สร้างอันแรกด้านล่าง</small>
              ) : (
                <ul className="team" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  {offices.map((o) => (
                    <li key={o.id}>
                      <button
                        className="member"
                        style={{ width: '100%', ...(office?.id === o.id ? { outline: '1px solid #ffd166' } : {}) }}
                        onClick={() => { onOffice(o); onClose(); }}
                      >
                        <b>{o.name}</b>
                        {o.owner_id === user.id && <em>เจ้าของ</em>}
                        {office?.id === o.id && <em style={{ marginLeft: 'auto' }}>กำลังใช้</em>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="field">
              <span>สร้างออฟฟิศใหม่</span>
              <div className="key-row">
                <input
                  value={newName} onChange={(e) => setNewName(e.target.value)}
                  placeholder="เช่น OneDD HQ" maxLength={80}
                />
                <button className="primary" onClick={create} disabled={busy || !newName.trim()}>
                  สร้าง
                </button>
              </div>
            </div>
          </>
        )}

        {msg && (
          <p className={`hint ${msg.ok ? '' : 'bad-msg'}`} style={{ color: msg.ok ? 'var(--acc)' : 'var(--acc2)' }}>
            {msg.ok ? '✓ ' : '⚠️ '}{msg.text}
          </p>
        )}
      </div>
    </div>
  );
}
