/**
 * ค่า public config (Supabase URL + publishable key) แบบอ่าน "ตอนรัน" ไม่ใช่ตอน build
 *
 * ปัญหา: Next inline ตัวแปร NEXT_PUBLIC_* ลง bundle ตอน build ถ้าแจก Docker image
 * ที่ build ไว้แล้ว ค่าจะว่างถาวร คนดึง image ไปตั้ง env เองไม่มีผล
 * ทางแก้: อ่านผ่าน key แบบ dynamic (webpack ไม่ inline) แล้วให้ layout ฝาก
 * window.__ENV ไว้ให้ฝั่งเบราว์เซอร์ - โค้ด client อ่านค่า inline ก่อน (กรณี build จาก source)
 * ไม่มีค่อยถอยมาใช้ window.__ENV (กรณี image สำเร็จรูป)
 */
const read = (k: string) => (process.env as Record<string, string | undefined>)[k] ?? '';

export interface PublicEnv {
  supabaseUrl: string;
  supabaseKey: string;
}

/** ฝั่งเซิร์ฟเวอร์: อ่านจาก process.env ตอนรัน (dynamic key - ไม่โดน inline) */
export function publicRuntimeEnv(): PublicEnv {
  return {
    supabaseUrl: read('NEXT_PUBLIC_SUPABASE_URL'),
    supabaseKey: read('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') || read('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  };
}

/** ฝั่งเบราว์เซอร์: ค่าที่ layout ฝากไว้ (สคริปต์ inline รันก่อน bundle เสมอ) */
export function windowEnv(): Partial<PublicEnv> {
  if (typeof window === 'undefined') return {};
  return (window as unknown as { __ENV?: Partial<PublicEnv> }).__ENV ?? {};
}
