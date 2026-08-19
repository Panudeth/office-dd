import 'server-only';
import { avatarDataUri, paletteParam } from '@/lib/avatar-png';
import { lineTokenForDept } from '@/lib/line-inbound';
import { sbAdmin } from '@/lib/supabase-admin';
import type { Palette } from '@/game/types';

/* ============================================================
   ช่องส่งออกของแผนก (Outbox) - เอาผลรายงานของแผนกไปโพสต์ต่อ
   office ไม่รู้จัก vendor: รู้แค่ "channel ชนิดไหน + config" แล้วเรียก adapter ตัวเดียวกันเสมอ
   เพิ่มช่องทางใหม่ = เพิ่ม adapter หนึ่งตัวในไฟล์นี้ (ไม่ต้องแตะ inbox/engine)
     teams   : Incoming Webhook / Workflows (POST Adaptive Card)
     slack   : Incoming Webhook (mrkdwn)
     discord : Webhook ({content} จำกัด 2000 ตัว - แบ่งฟอง)
     line    : Messaging API push (ต้องมี to = userId/groupId; token ใน config หรือ LINE_CHANNEL_ACCESS_TOKEN)
     webhook : POST JSON ทั่วไป (ต่อ n8n/Make/ระบบของตัวเอง)
   ============================================================ */

export type ChannelKind = 'teams' | 'slack' | 'discord' | 'line' | 'webhook';
export const CHANNEL_KINDS: ChannelKind[] = ['teams', 'slack', 'discord', 'line', 'webhook'];

export interface ChannelRow {
  id: string;
  dept_id: string;
  kind: ChannelKind;
  label: string;
  config: Record<string, string>;
  events: string[];
  enabled: boolean;
}

export interface ReportPayload {
  officeId: string;
  deptId: string;
  deptName: string;
  title: string;
  /** เนื้อรายงาน (markdown จากประธาน/หัวหน้าแผนก) */
  text: string;
  meetingId: string | null;
  inboxId: string | null;
  source: string;
  /** ลิงก์กลับมาที่ออฟฟิศ (ถ้ารู้ origin) */
  link?: string;
  /** คนรายงาน (หัวหน้าแผนก) - ชื่อ ตำแหน่ง และสีตัวละคร เอาไปวาดหน้า pixel บนการ์ด */
  reporter?: { name: string; title: string; palette: Palette };
  /** บทสนทนาลูกค้า (LINE ฯลฯ) - ชื่อ/รูปลูกค้า + คำถาม/คำตอบ แยกช่องให้การ์ดจัดหน้าได้ */
  customer?: { name: string; pictureUrl?: string; channel: string };
  question?: string;
  answer?: string;
}

export interface DeliveryResult { channelId: string; kind: ChannelKind; label: string; ok: boolean; error?: string }

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
const chunks = (s: string, n: number) => {
  const out: string[] = [];
  let rest = s.trim();
  while (rest.length && out.length < 5) { out.push(rest.slice(0, n)); rest = rest.slice(n); }
  return out.length ? out : ['(ว่าง)'];
};

async function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${clip(await res.text().catch(() => ''), 200)}`);
}

const isHttps = (u: string) => /^https:\/\/[^\s]+$/i.test(u);
/** URL รูปหน้าที่ระบบข้างนอกโหลดได้ - ต้องเป็นโดเมนจริง (localhost ไม่มีใครเห็น) */
const avatarUrl = (p: ReportPayload) => {
  if (!p.reporter || !p.link) return null;
  try {
    const u = new URL(p.link);
    if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(u.hostname) || u.protocol !== 'https:') return null;
    return `${u.origin}/api/avatar?p=${paletteParam(p.reporter.palette)}&s=4`;
  } catch { return null; }
};
const byline = (p: ReportPayload) => (p.reporter ? `${p.reporter.name} · ${p.reporter.title} · ${p.deptName}` : p.deptName);

/** ส่งรายงานเข้า channel เดียว - โยน error ถ้าไม่สำเร็จ (คนเรียกเก็บผลต่อ channel) */
export async function sendToChannel(ch: ChannelRow, p: ReportPayload): Promise<void> {
  const head = `${p.title || 'รายงาน'} · ${p.deptName}`;
  const foot = [p.source ? `ที่มา: ${p.source}` : '', p.link ? p.link : ''].filter(Boolean).join(' · ');
  switch (ch.kind) {
    case 'teams': {
      const url = ch.config.url ?? '';
      if (!isHttps(url)) throw new Error('ไม่มี webhook URL');
      // หัวการ์ด: รูปหน้า pixel (data URI - Teams รับ base64) + ชื่อ/ตำแหน่ง/แผนก
      const header = p.reporter
        ? {
          type: 'ColumnSet',
          columns: [
            { type: 'Column', width: 'auto', items: [{ type: 'Image', url: avatarDataUri(p.reporter.palette, 4), size: 'Small', altText: p.reporter.name }] },
            {
              type: 'Column', width: 'stretch', verticalContentAlignment: 'Center',
              items: [
                { type: 'TextBlock', text: p.reporter.name, weight: 'Bolder', wrap: true },
                { type: 'TextBlock', text: `${p.reporter.title} · ${p.deptName}`, isSubtle: true, size: 'Small', spacing: 'None', wrap: true },
              ],
            },
          ],
        }
        : { type: 'TextBlock', text: p.deptName, isSubtle: true, size: 'Small' };
      // แชทลูกค้า: บล็อกลูกค้า (รูปโปรไฟล์ + ชื่อ + ช่องทาง) -> คำถาม -> คำตอบ -> คนตอบ
      const customerBlock = p.customer
        ? {
          type: 'ColumnSet',
          columns: [
            ...(p.customer.pictureUrl ? [{ type: 'Column', width: 'auto', items: [{ type: 'Image', url: p.customer.pictureUrl, size: 'Small', style: 'Person', altText: p.customer.name }] }] : []),
            {
              type: 'Column', width: 'stretch', verticalContentAlignment: 'Center',
              items: [
                { type: 'TextBlock', text: p.customer.name, weight: 'Bolder', wrap: true },
                { type: 'TextBlock', text: `ลูกค้า · ${p.customer.channel}`, isSubtle: true, size: 'Small', spacing: 'None' },
              ],
            },
          ],
        }
        : null;
      const body = p.customer && p.question !== undefined
        ? [
          customerBlock,
          { type: 'TextBlock', text: clip(p.question, 3_000), wrap: true, weight: 'Bolder', spacing: 'Medium' },
          { type: 'Container', style: 'emphasis', spacing: 'Small', items: [
            { type: 'TextBlock', text: 'ตอบลูกค้าว่า', isSubtle: true, size: 'Small' },
            { type: 'TextBlock', text: clip(p.answer ?? '', 20_000), wrap: true, spacing: 'None' },
          ] },
          ...(p.reporter ? [{
            type: 'ColumnSet', spacing: 'Small',
            columns: [
              { type: 'Column', width: 'auto', items: [{ type: 'Image', url: avatarDataUri(p.reporter.palette, 3), width: '28px', altText: p.reporter.name }] },
              { type: 'Column', width: 'stretch', verticalContentAlignment: 'Center', items: [
                { type: 'TextBlock', text: `ตอบโดย **${p.reporter.name}** · ${p.reporter.title} · ${p.deptName}`, isSubtle: true, size: 'Small', wrap: true },
              ] },
            ],
          }] : []),
          ...(foot ? [{ type: 'TextBlock', text: foot, isSubtle: true, size: 'Small', wrap: true }] : []),
        ]
        : [
          header,
          { type: 'TextBlock', text: p.title || 'รายงาน', weight: 'Bolder', size: 'Medium', wrap: true },
          { type: 'TextBlock', text: clip(p.text, 20_000), wrap: true },
          ...(foot ? [{ type: 'TextBlock', text: foot, isSubtle: true, size: 'Small', wrap: true }] : []),
        ];
      // Workflows (Power Automate) รับ Adaptive Card; connector เก่า (O365) ก็รับรูปนี้ได้
      await post(url, {
        type: 'message',
        attachments: [{
          contentType: 'application/vnd.microsoft.card.adaptive',
          contentUrl: null,
          content: { $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4', body },
        }],
      });
      return;
    }
    case 'slack': {
      const url = ch.config.url ?? '';
      if (!isHttps(url)) throw new Error('ไม่มี webhook URL');
      const img = avatarUrl(p);
      const text = clip(`*${head}*\n${p.text}${foot ? `\n_${foot}_` : ''}`, 39_000);
      await post(url, {
        text,
        blocks: [
          ...(p.customer ? [{ type: 'context', elements: [...(p.customer.pictureUrl ? [{ type: 'image', image_url: p.customer.pictureUrl, alt_text: p.customer.name }] : []), { type: 'mrkdwn', text: `*${p.customer.name}* · ลูกค้า · ${p.customer.channel}` }] }] : []),
          { type: 'context', elements: [...(img ? [{ type: 'image', image_url: img, alt_text: p.reporter?.name ?? '' }] : []), { type: 'mrkdwn', text: byline(p) }] },
          { type: 'section', text: { type: 'mrkdwn', text: clip(`*${p.title || 'รายงาน'}*\n${p.text}`, 2_900) } },
          ...(foot ? [{ type: 'context', elements: [{ type: 'mrkdwn', text: foot }] }] : []),
        ],
      });
      return;
    }
    case 'discord': {
      const url = ch.config.url ?? '';
      if (!isHttps(url)) throw new Error('ไม่มี webhook URL');
      const img = avatarUrl(p);
      const parts = chunks(p.text, 3_900);
      for (let i = 0; i < parts.length; i++) {
        await post(url, {
          embeds: [{
            author: { name: byline(p), ...(img ? { icon_url: img } : {}) },
            ...(p.customer?.pictureUrl && i === 0 ? { thumbnail: { url: p.customer.pictureUrl } } : {}),
            title: i === 0 ? clip(p.title || 'รายงาน', 250) : undefined,
            description: parts[i],
            ...(i === parts.length - 1 && foot ? { footer: { text: clip(foot, 2000) } } : {}),
          }],
        });
      }
      return;
    }
    case 'line': {
      // token: กรอกในช่อง > LINE OA ที่ผูกกับแผนก (แท็บ Webhook เข้า) > .env
      const token = (ch.config.token ?? '').trim() || (await lineTokenForDept(p.officeId, p.deptId)) || process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
      const to = (ch.config.to ?? '').trim();
      if (!token) throw new Error('ไม่มี channel access token (ใส่ในช่องนี้ หรือผูก LINE OA ในแท็บ Webhook เข้า)');
      if (!to) throw new Error('ไม่มีปลายทาง (userId/groupId)');
      const parts = chunks(`${p.title || 'รายงาน'}\n${byline(p)}\n\n${p.text}${foot ? `\n\n${foot}` : ''}`, 4_500);
      const img = avatarUrl(p);
      await post('https://api.line.me/v2/bot/message/push', {
        to,
        messages: parts.map((t, i) => (i === 0 && img
          ? { type: 'text', text: t, sender: { name: p.reporter!.name.slice(0, 20), iconUrl: img } }
          : { type: 'text', text: t })),
      }, { Authorization: `Bearer ${token}` });
      return;
    }
    case 'webhook': {
      const url = ch.config.url ?? '';
      if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new Error('ไม่มี URL');
      await post(url, {
        event: 'report', officeId: p.officeId, deptId: p.deptId, deptName: p.deptName,
        title: p.title, text: p.text, meetingId: p.meetingId, inboxId: p.inboxId, source: p.source,
        reporter: p.reporter ? { name: p.reporter.name, title: p.reporter.title, avatarUrl: avatarUrl(p) } : null,
        customer: p.customer ?? null, question: p.question ?? null, answer: p.answer ?? null,
        link: p.link ?? null, at: new Date().toISOString(),
      }, ch.config.secret ? { 'X-Office-Secret': ch.config.secret } : {});
      return;
    }
    default:
      throw new Error(`ไม่รู้จักช่องทาง ${String(ch.kind)}`);
  }
}

/** ช่องนี้รับรายงานจากแหล่งนี้ไหม - config.sources = รายชื่อแหล่งคั่นจุลภาค (ว่าง = ทุกแหล่ง) เทียบแบบไม่สนตัวพิมพ์ ตรงทั้งคำหรือขึ้นต้น */
export function matchesSource(ch: ChannelRow, source: string): boolean {
  const want = (ch.config.sources ?? '').split(/[,\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!want.length) return true;
  const src = (source ?? '').trim().toLowerCase();
  if (!src) return false;
  return want.some((w) => src === w || src.startsWith(w) || src.includes(w));
}

/** channel ของแผนกที่เปิดอยู่และรับ event นี้ */
export async function loadDeptChannels(officeId: string, deptId: string, event = 'report'): Promise<ChannelRow[]> {
  const c = sbAdmin();
  if (!c) return [];
  const { data, error } = await c.from('office_dept_channel').select('id,dept_id,kind,label,config,events,enabled')
    .eq('office_id', officeId).eq('dept_id', deptId).eq('enabled', true);
  if (error || !data) return [];
  return (data as ChannelRow[]).filter((r) => CHANNEL_KINDS.includes(r.kind) && (r.events ?? []).includes(event));
}

/**
 * ส่งรายงานไปทุก channel ของแผนก - channel ไหนพังก็ข้าม เก็บผลไว้บอกผู้ใช้ (ไม่โยน)
 * only = จำกัดเฉพาะบางชนิด/บาง id (จาก body.deliver ของ inbox)
 */
export async function deliverReport(p: ReportPayload, only?: string[]): Promise<DeliveryResult[]> {
  let list = await loadDeptChannels(p.officeId, p.deptId);
  if (only?.length) list = list.filter((ch) => only.includes(ch.kind) || only.includes(ch.id) || only.includes(ch.label));
  // ช่องที่ตั้ง "รับจากแหล่ง" ไว้ จะรับเฉพาะรายงานที่ source ตรง (ว่าง = ทุกแหล่ง) - ทำให้ GCP ไปช่องหนึ่ง logger ไปอีกช่องได้
  list = list.filter((ch) => matchesSource(ch, p.source));
  const out: DeliveryResult[] = [];
  for (const ch of list) {
    try {
      await sendToChannel(ch, p);
      out.push({ channelId: ch.id, kind: ch.kind, label: ch.label, ok: true });
    } catch (e) {
      out.push({ channelId: ch.id, kind: ch.kind, label: ch.label, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
