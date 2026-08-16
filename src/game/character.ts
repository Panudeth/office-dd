import { dith4, mk, shade } from './art';
import type { Dir, Palette, Pose } from './types';

/* จานสีโทน Generation 3 (GBA) — อิ่มตัวปานกลาง ไม่ใช้สีดำสนิท */
export const SKIN = ['#f8d0a8', '#e8b088', '#c88c60', '#a06840'];
export const HAIR = ['#403848', '#684830', '#a86038', '#e0c060', '#985880', '#405888', '#c05048', '#584030'];
export const PANTS = ['#485878', '#6b5840', '#3c5878', '#585868', '#785868'];
export const SHOES = ['#403848', '#584030', '#e0e0e8'];

export const DIRS: Dir[] = ['down', 'up', 'left', 'right'];

type G = CanvasRenderingContext2D;
const P = (g: G, x: number, y: number, w: number, h: number, c: string) => {
  g.fillStyle = c;
  g.fillRect(x, y, w, h);
};

/** สร้าง palette จาก seed — สีเสื้อมาจากแผนก จะได้แยกทีมออกบนแผนที่ */
export function makePalette(seed: number, shirt: string): Palette {
  const pick = <T,>(arr: T[], salt: number) => arr[Math.abs((seed * 2654435761 + salt * 97) | 0) % arr.length];
  return {
    skin: pick(SKIN, 1),
    hair: pick(HAIR, 2),
    shirt,
    pants: pick(PANTS, 3),
    shoes: pick(SHOES, 4),
  };
}

/** ตัวละคร 16x24 วาดแบบ parametric — outline เป็นสีเข้มของวัสดุนั้น ๆ (สไตล์ gen 3) */
export function drawChar(g: G, pal: Palette, dir: Dir, pose: Pose, frame: number) {
  const sk = pal.skin, ha = pal.hair, sh = pal.shirt, pa = pal.pants, so = pal.shoes;
  const shD = shade(sh, 0.78), shL = shade(sh, 1.15), haL = shade(ha, 1.3);
  const OUT_H = shade(ha, 0.52), OUT_S = shade(sk, 0.55), OUT_B = shade(sh, 0.5);
  const OUT_P = shade(pa, 0.55), OUT_F = shade(so, 0.6);

  const sit = pose === 'sit';
  const bob = pose === 'walk' && (frame === 1 || frame === 3) ? -1 : 0;
  const dy = (sit ? 2 : 0) + bob;
  const mirror = dir === 'left';

  g.save();
  if (mirror) { g.translate(16, 0); g.scale(-1, 1); }
  const d: Dir = dir === 'left' ? 'right' : dir;

  /* ---- หัว ---- */
  P(g, 3, 1 + dy, 10, 5, OUT_H);
  P(g, 3, 6 + dy, 10, 6, OUT_S);
  if (d === 'up') {
    P(g, 3, 1 + dy, 10, 10, OUT_H);
    P(g, 4, 2 + dy, 8, 9, ha);
    P(g, 4, 2 + dy, 8, 1, haL); P(g, 5, 3 + dy, 6, 1, shade(ha, 1.15));
    dith4(g, 9, 4 + dy, 3, 6, shade(ha, 0.78), 0);
    P(g, 3, 7 + dy, 1, 2, sk); P(g, 12, 7 + dy, 1, 2, sk);
  } else if (d === 'down') {
    P(g, 4, 2 + dy, 8, 9, sk);
    P(g, 4, 2 + dy, 8, 4, ha); P(g, 4, 2 + dy, 8, 1, haL);
    P(g, 4, 6 + dy, 1, 1, ha); P(g, 11, 6 + dy, 1, 1, ha);
    P(g, 3, 7 + dy, 1, 2, sk); P(g, 12, 7 + dy, 1, 2, sk);
    dith4(g, 10, 7 + dy, 2, 4, shade(sk, 0.86), 0);
    P(g, 5, 7 + dy, 2, 2, OUT_H); P(g, 9, 7 + dy, 2, 2, OUT_H);
    P(g, 5, 7 + dy, 1, 1, '#f8f8f8'); P(g, 9, 7 + dy, 1, 1, '#f8f8f8');
    P(g, 7, 10 + dy, 2, 1, shade(sk, 0.72));
  } else {
    P(g, 4, 2 + dy, 8, 9, sk);
    P(g, 4, 2 + dy, 8, 4, ha); P(g, 4, 2 + dy, 8, 1, haL);
    P(g, 3, 3 + dy, 2, 4, ha); P(g, 4, 6 + dy, 1, 1, ha);
    dith4(g, 5, 8 + dy, 4, 3, shade(sk, 0.86), 0);
    P(g, 9, 7 + dy, 2, 2, OUT_H); P(g, 9, 7 + dy, 1, 1, '#f8f8f8');
    P(g, 12, 7 + dy, 1, 2, sk);
    P(g, 10, 10 + dy, 2, 1, shade(sk, 0.72));
  }

  /* ---- ลำตัว ---- */
  P(g, 3, 11 + dy, 10, 8, OUT_B);
  P(g, 4, 12 + dy, 8, 6, sh);
  P(g, 4, 12 + dy, 8, 1, shL);
  dith4(g, 9, 13 + dy, 3, 5, shD, 0);
  if (d === 'down') { P(g, 6, 12 + dy, 4, 2, shade(sh, 0.92)); P(g, 7, 14 + dy, 2, 4, shD); }
  if (d === 'up') P(g, 6, 12 + dy, 4, 1, shD);

  /* ---- แขน ---- */
  let aL = 0, aR = 0;
  if (pose === 'walk') { aL = frame === 0 ? -1 : frame === 2 ? 1 : 0; aR = -aL; }
  if (sit) {
    const tl = frame === 0 || frame === 1 ? 1 : 0;
    const tr = frame === 2 || frame === 3 ? 1 : 0;
    P(g, 2, 15 + dy, 2, 5, OUT_B); P(g, 12, 15 + dy, 2, 5, OUT_B);
    P(g, 2, 15 + dy, 2, 3, shD); P(g, 12, 15 + dy, 2, 3, shD);
    P(g, 2, 18 + dy - tl, 2, 2, sk); P(g, 12, 18 + dy - tr, 2, 2, sk);
    P(g, 2, 18 + dy - tl, 2, 1, shade(sk, 1.08)); P(g, 12, 18 + dy - tr, 2, 1, shade(sk, 1.08));
  } else if (d === 'right') {
    P(g, 6, 13 + dy + aL, 3, 5, OUT_B); P(g, 6, 13 + dy + aL, 3, 4, shD); P(g, 6, 17 + dy + aL, 3, 1, sk);
  } else {
    P(g, 2, 12 + dy + aL, 2, 6, OUT_B); P(g, 2, 12 + dy + aL, 2, 5, shD); P(g, 2, 17 + dy + aL, 2, 1, sk);
    P(g, 12, 12 + dy + aR, 2, 6, OUT_B); P(g, 12, 12 + dy + aR, 2, 5, shD); P(g, 12, 17 + dy + aR, 2, 1, sk);
  }

  /* ---- ขา ---- */
  if (sit) {
    P(g, 4, 18 + dy, 8, 6, OUT_P);
    P(g, 4, 19 + dy, 8, 5, pa);
    P(g, 7, 19 + dy, 2, 5, shade(pa, 0.8));
    dith4(g, 9, 19 + dy, 3, 5, shade(pa, 0.82), 0);
  } else {
    const step = pose === 'walk' ? (frame === 0 ? 1 : frame === 2 ? -1 : 0) : 0;
    if (d === 'right') {
      const fx = 6 + step * 2, bx = 4 - step * 2;
      P(g, 3, 18 + dy, 10, 6, OUT_P);
      P(g, 5, 18 + dy, 6, 3, pa);
      P(g, bx, 20 + dy, 5, 3, shade(pa, 0.8)); P(g, bx, 22 + dy, 5, 2, shade(so, 0.7));
      P(g, fx, 20 + dy, 5, 3, pa); P(g, fx, 22 + dy, 5, 2, so); P(g, fx, 23 + dy, 5, 1, OUT_F);
    } else {
      P(g, 4, 18 + dy, 8, 6, OUT_P);
      P(g, 5, 18 + dy, 6, 3, pa);
      P(g, 7, 19 + dy, 2, 2, shade(pa, 0.72));
      const lu = step > 0 ? 2 : 0, ru = step < 0 ? 2 : 0;
      const lx = 4 - (step > 0 ? 1 : 0), rx = 9 + (step < 0 ? 1 : 0);
      P(g, lx, 19 + dy, 3, 4 - lu, pa);
      P(g, rx, 19 + dy, 3, 4 - ru, pa);
      P(g, lx, 21 + dy - lu, 3, 2, so);
      P(g, rx, 21 + dy - ru, 3, 2, so);
      P(g, lx, 22 + dy - lu, 3, 1, OUT_F);
      P(g, rx, 22 + dy - ru, 3, 1, OUT_F);
    }
  }
  g.restore();
}

/** atlas ต่อ 1 คน: 4 ทิศ x (walk 4 เฟรม + sit 4 เฟรม) */
export function buildAtlas(pal: Palette): HTMLCanvasElement {
  const a = mk(16 * 8, 24 * 4);
  DIRS.forEach((d, di) => {
    for (let f = 0; f < 4; f++) {
      a.g.save(); a.g.translate(f * 16, di * 24); drawChar(a.g, pal, d, 'walk', f); a.g.restore();
      a.g.save(); a.g.translate((4 + f) * 16, di * 24); drawChar(a.g, pal, d, 'sit', f); a.g.restore();
    }
  });
  return a.c;
}
