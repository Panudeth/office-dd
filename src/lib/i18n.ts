/**
 * i18n แบบเบา ๆ ไม่ใช้ lib: key = ข้อความไทยต้นฉบับ, ค่า = คำแปลอังกฤษ
 *   t('บันทึก')                         -> 'Save' (en) / 'บันทึก' (th)
 *   t('{name} กำลังตอบ...', { name })    -> แทน {name} หลังแปล
 * ไม่มีคำแปล = คืนไทยตามเดิม (จะได้ไม่พังแค่เพราะลืมแปล - ไล่หาทีหลังได้ด้วย grep ไทยบนหน้าจอ)
 *
 * ภาษาเก็บใน localStorage 'vc_lang' - ดีฟอลต์อังกฤษ
 * ใช้ได้ทั้งใน React (useLang / useT) และนอก React (world.ts วาด canvas เรียก t() ตรง ๆ)
 */
import { useSyncExternalStore } from 'react';
import { EN } from '@/i18n/en';

export type Lang = 'en' | 'th';
export const LANGS: { id: Lang; label: string }[] = [
  { id: 'en', label: 'EN' },
  { id: 'th', label: 'ไทย' },
];
const KEY = 'vc_lang';

let cur: Lang = 'en';
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  const v = window.localStorage.getItem(KEY);
  if (v === 'th' || v === 'en') cur = v;
  document.documentElement.lang = cur;
}

export function getLang(): Lang { load(); return cur; }
export function setLang(l: Lang) {
  load();
  if (l === cur) return;
  cur = l;
  try { window.localStorage.setItem(KEY, l); } catch { /* private mode */ }
  document.documentElement.lang = l;
  listeners.forEach((f) => f());
}
export function toggleLang() { setLang(cur === 'en' ? 'th' : 'en'); }

function interpolate(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** แปลข้อความ - key คือไทยต้นฉบับ */
export function t(th: string, vars?: Record<string, string | number>): string {
  load();
  const s = cur === 'th' ? th : (EN[th] ?? th);
  return vars ? interpolate(s, vars) : s;
}

/** เลือกค่าตามภาษา (กรณีคำแปลไม่ได้อยู่ใน dictionary เช่นชื่อแผนกที่มี nameEn อยู่แล้ว) */
export function pick<T>(thValue: T, enValue: T | undefined | null): T {
  load();
  return cur === 'th' ? thValue : (enValue ?? thValue);
}

const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
const snap = () => { load(); return cur; };
const serverSnap = (): Lang => 'en';

/** ใช้ใน component - re-render เมื่อสลับภาษา */
export function useLang(): [Lang, (l: Lang) => void] {
  const l = useSyncExternalStore(subscribe, snap, serverSnap);
  return [l, setLang];
}
/** ทางลัด: const t = useT(); แล้วใช้ t('...') ได้เลย component จะ re-render เมื่อสลับภาษา */
export function useT() {
  useSyncExternalStore(subscribe, snap, serverSnap);
  return t;
}
