import type { ReactNode } from 'react';

/**
 * ตัวจัดรูปแบบเล็ก ๆ รองรับ **ตัวหนา** และ bullet
 * ไม่ใช้ innerHTML เพราะข้อความมาจาก LLM ซึ่งถือว่าไม่น่าไว้ใจ
 */
export function fmt(text: string): ReactNode {
  return text.split('\n').map((line, i) => {
    const bullet = /^\s*[-•]\s+/.test(line);
    const body = bullet ? line.replace(/^\s*[-•]\s+/, '') : line;
    const parts = body.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
    const nodes = parts.map((p, j) =>
      p.startsWith('**') && p.endsWith('**') ? (
        <strong key={j} className="font-semibold text-white">{p.slice(2, -2)}</strong>
      ) : (
        <span key={j}>{p}</span>
      ),
    );
    if (!body.trim()) return <div key={i} className="h-1.5" />;
    return bullet ? (
      <div key={i} className="flex gap-1.5">
        <span className="text-carpet-lite">-</span>
        <span>{nodes}</span>
      </div>
    ) : (
      <p key={i}>{nodes}</p>
    );
  });
}
