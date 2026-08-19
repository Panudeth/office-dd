import 'server-only';
import { sbAdmin } from '@/lib/supabase-admin';

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

/** ส่งรายงานเข้า channel เดียว - โยน error ถ้าไม่สำเร็จ (คนเรียกเก็บผลต่อ channel) */
export async function sendToChannel(ch: ChannelRow, p: ReportPayload): Promise<void> {
  const head = `${p.title || 'รายงาน'} · ${p.deptName}`;
  const foot = [p.source ? `ที่มา: ${p.source}` : '', p.link ? p.link : ''].filter(Boolean).join(' · ');
  switch (ch.kind) {
    case 'teams': {
      const url = ch.config.url ?? '';
      if (!isHttps(url)) throw new Error('ไม่มี webhook URL');
      const body = [
        { type: 'TextBlock', text: head, weight: 'Bolder', size: 'Medium', wrap: true },
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
      await post(url, { text: clip(`*${head}*\n${p.text}${foot ? `\n_${foot}_` : ''}`, 39_000) });
      return;
    }
    case 'discord': {
      const url = ch.config.url ?? '';
      if (!isHttps(url)) throw new Error('ไม่มี webhook URL');
      const parts = chunks(`**${head}**\n${p.text}${foot ? `\n-# ${foot}` : ''}`, 1_950);
      for (const c of parts) await post(url, { content: c });
      return;
    }
    case 'line': {
      const token = (ch.config.token ?? '').trim() || process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
      const to = (ch.config.to ?? '').trim();
      if (!token) throw new Error('ไม่มี channel access token (ใส่ใน channel หรือ LINE_CHANNEL_ACCESS_TOKEN)');
      if (!to) throw new Error('ไม่มีปลายทาง (userId/groupId)');
      const parts = chunks(`${head}\n\n${p.text}${foot ? `\n\n${foot}` : ''}`, 4_500);
      await post('https://api.line.me/v2/bot/message/push', {
        to, messages: parts.map((t) => ({ type: 'text', text: t })),
      }, { Authorization: `Bearer ${token}` });
      return;
    }
    case 'webhook': {
      const url = ch.config.url ?? '';
      if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new Error('ไม่มี URL');
      await post(url, {
        event: 'report', officeId: p.officeId, deptId: p.deptId, deptName: p.deptName,
        title: p.title, text: p.text, meetingId: p.meetingId, inboxId: p.inboxId, source: p.source,
        link: p.link ?? null, at: new Date().toISOString(),
      }, ch.config.secret ? { 'X-Office-Secret': ch.config.secret } : {});
      return;
    }
    default:
      throw new Error(`ไม่รู้จักช่องทาง ${String(ch.kind)}`);
  }
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
