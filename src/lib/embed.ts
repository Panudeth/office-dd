import type { Creds } from './llm';
import { DEFAULT_OPENAI_BASE, isLocalBase } from './openai';

/* ============================================================
   Embedding - แปลงข้อความเป็น vector 768 มิติ สำหรับค้นเอกสาร (เฟส 3)

   ทำไม 768: เป็นขนาดที่ Gemini text-embedding-004 และ nomic-embed-text (Ollama) ให้ตรงกัน
   OpenAI text-embedding-3-small ปกติ 1536 แต่รับ dimensions=768 ได้ (Matryoshka)
   ตาราง office_doc_chunk ล็อกไว้ที่ 768 - vector คนละโมเดลห้ามเทียบกัน จึงเก็บ embed_model กำกับทุกแถว
   ============================================================ */

export const EMBED_DIM = 768;

export interface EmbedResult {
  vectors: number[][];
  /** ตัวชี้โมเดล - เก็บลง chunk และใช้กรองตอนค้น */
  model: string;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new HttpError(0, err instanceof Error ? err.message : String(err));
  }
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* ไม่ใช่ JSON */ }
  if (!res.ok) {
    const o = data as { error?: { message?: string } | string } | null;
    const msg = typeof o?.error === 'string' ? o.error : o?.error?.message ?? text.slice(0, 300);
    throw new HttpError(res.status, msg);
  }
  return data;
}

/** โมเดล embedding ที่จะใช้ตาม provider/ปลายทาง - บอกชื่อได้โดยไม่ต้องยิง */
export function embedModelFor(creds: Creds): string {
  if (creds.provider === 'gemini') return 'gemini:text-embedding-004';
  if (creds.provider === 'openai') {
    const base = creds.baseUrl || DEFAULT_OPENAI_BASE;
    if (isLocalBase(base)) return 'ollama:nomic-embed-text';
    if (base.includes('api.openai.com')) return 'openai:text-embedding-3-small@768';
    // เจ้าอื่นที่พูด OpenAI API - ส่วนใหญ่ไม่มี /embeddings ให้ (Groq, Cerebras) จะพังตอนเรียกจริง
    return `openai-compat:${new URL(base).host}`;
  }
  return 'none';
}

/**
 * แปลงข้อความหลายชิ้นเป็น vector
 * ตัดยาวไม่เกิน 96 ชิ้นต่อคอล (Gemini batchEmbedContents รับ 100) - คนเรียกแบ่งเองถ้าเกิน
 */
export async function embedTexts(texts: string[], creds: Creds): Promise<EmbedResult> {
  if (!texts.length) return { vectors: [], model: embedModelFor(creds) };

  if (creds.provider === 'gemini') {
    const model = 'text-embedding-004';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${encodeURIComponent(creds.apiKey)}`;
    const data = await postJson(url, {}, {
      requests: texts.map((t) => ({
        model: `models/${model}`,
        content: { parts: [{ text: t }] },
        outputDimensionality: EMBED_DIM,
      })),
    }) as { embeddings?: { values: number[] }[] };
    const vectors = (data.embeddings ?? []).map((e) => e.values);
    if (vectors.length !== texts.length) throw new Error('Gemini คืน embedding ไม่ครบจำนวน');
    return { vectors, model: 'gemini:text-embedding-004' };
  }

  if (creds.provider === 'openai') {
    const base = (creds.baseUrl || DEFAULT_OPENAI_BASE).replace(/\/+$/, '');
    const local = isLocalBase(base);
    const model = local ? 'nomic-embed-text' : 'text-embedding-3-small';
    const label = embedModelFor(creds);
    let data: { data?: { embedding: number[]; index: number }[] };
    try {
      data = await postJson(`${base}/embeddings`,
        creds.apiKey ? { Authorization: `Bearer ${creds.apiKey}` } : {},
        // Ollama ไม่รู้จัก dimensions - ส่งไปเฉพาะ OpenAI แท้
        local ? { model, input: texts } : { model, input: texts, dimensions: EMBED_DIM },
      ) as typeof data;
    } catch (err) {
      const status = err instanceof HttpError ? err.status : -1;
      if (local && status === 404) {
        throw new Error(
          'Ollama ยังไม่มีโมเดล embedding - รัน "ollama pull nomic-embed-text" ก่อน แล้วลองอัปโหลดใหม่',
        );
      }
      if (status === 404) {
        throw new Error(`${base} ไม่มีเส้นทาง /embeddings - ผู้ให้บริการนี้ทำ embedding ไม่ได้ ใช้ Gemini, OpenAI หรือ Ollama แทนสำหรับเอกสาร`);
      }
      throw new Error(err instanceof Error ? err.message : String(err));
    }
    const rows = [...(data.data ?? [])].sort((a, b) => a.index - b.index);
    const vectors = rows.map((r) => r.embedding);
    if (vectors.length !== texts.length) throw new Error('ผู้ให้บริการคืน embedding ไม่ครบจำนวน');
    const dim = vectors[0]?.length ?? 0;
    if (dim !== EMBED_DIM) {
      throw new Error(`โมเดล ${model} ให้ vector ${dim} มิติ แต่ระบบต้องการ ${EMBED_DIM} - ใช้ nomic-embed-text (Ollama) หรือ Gemini แทน`);
    }
    return { vectors, model: label };
  }

  throw new Error(
    'Claude ไม่มี embedding API - การอัปโหลดเอกสารต้องใช้การเชื่อมต่อที่เป็น Gemini, OpenAI หรือ Ollama (สลับได้ที่ปุ่มคีย์ของฉัน)',
  );
}

/* ---------- ตัดเอกสารเป็นชิ้น ---------- */

/**
 * ตัดตามย่อหน้าก่อน แล้วค่อยรวมย่อหน้าติดกันจนใกล้ ~900 ตัวอักษร ทับกัน ~120
 * ภาษาไทยไม่มีช่องว่างระหว่างคำ จึงตัดที่ขึ้นบรรทัดใหม่/ประโยค ไม่ตัดกลางคำ
 */
export function chunkText(text: string, target = 900, overlap = 120): string[] {
  const paras = text.replace(/\r\n/g, '\n').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  const push = () => { if (cur.trim()) out.push(cur.trim()); };
  for (const p of paras) {
    if (p.length > target * 1.5) {
      // ย่อหน้ายักษ์ - ตัดตามประโยค/บรรทัด
      push(); cur = '';
      const sents = p.split(/(?<=[\.\!\?。])\s+|\n/).filter(Boolean);
      for (const s of sents) {
        if ((cur + ' ' + s).length > target && cur) { out.push(cur.trim()); cur = cur.slice(-overlap) + ' ' + s; }
        else cur = cur ? cur + ' ' + s : s;
      }
      push(); cur = '';
      continue;
    }
    if ((cur + '\n\n' + p).length > target && cur) {
      out.push(cur.trim());
      cur = cur.slice(-overlap) + '\n\n' + p;
    } else {
      cur = cur ? cur + '\n\n' + p : p;
    }
  }
  push();
  return out;
}
