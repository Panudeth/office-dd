import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** รวมคลาสแล้วให้อันหลังชนะอันหน้าเมื่อชนกัน (เช่น px-2 ทับ px-4) */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
