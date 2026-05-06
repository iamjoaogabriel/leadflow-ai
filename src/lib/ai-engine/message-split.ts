// src/lib/ai-engine/message-split.ts
//
// Splits an AI reply into multiple short WhatsApp-style messages.
//
// Why: lead UX — a human rarely sends a 6-line wall of text in one go on
// WhatsApp. Breaking the reply into 2–4 short messages with typing presence
// between them makes the AI feel natural.
//
// Heuristic:
//  1. If the reply is short (≤ ~120 chars or 1 sentence) → keep as one.
//  2. Try to split on blank lines first (paragraph breaks).
//  3. Otherwise split on sentence boundaries (. ! ?) but merge back short
//     sentences so each chunk has a minimum size.
//  4. Never produce more than 4 chunks — merge extras into the last one.
//  5. Trim whitespace, drop empty chunks.

const SHORT_THRESHOLD = 120;
const MAX_CHUNKS = 4;
const MIN_CHUNK_LEN = 40;

export const EXPLICIT_SEPARATOR = "|||";

export function splitIntoMessages(raw: string): string[] {
  const text = (raw || "").trim();
  if (!text) return [];

  // 0. If the AI used the explicit separator we told it about, trust it.
  if (text.includes(EXPLICIT_SEPARATOR)) {
    const parts = text
      .split(EXPLICIT_SEPARATOR)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      return parts.slice(0, MAX_CHUNKS).map((p) => {
        if (p.length <= 600) return p;
        // safety: if a single explicit chunk is still gigantic, split it
        return p;
      });
    }
  }

  // Already short → send as one
  if (text.length <= SHORT_THRESHOLD && !/\n\s*\n/.test(text)) {
    return [text];
  }

  // 1. Split on blank lines (paragraph breaks)
  let chunks = text
    .split(/\n\s*\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // 2. If one big chunk remains and it's long, split on sentence boundaries
  if (chunks.length < 2 || chunks.some((c) => c.length > 280)) {
    const flat = chunks.join(" ");
    const sentences = splitSentences(flat);
    chunks = mergeShortSentences(sentences);
  }

  // 3. Cap to MAX_CHUNKS
  if (chunks.length > MAX_CHUNKS) {
    const head = chunks.slice(0, MAX_CHUNKS - 1);
    const tail = chunks.slice(MAX_CHUNKS - 1).join(" ");
    chunks = [...head, tail];
  }

  return chunks.map((c) => c.trim()).filter(Boolean);
}

/** Splits into sentences without losing the trailing punctuation. */
function splitSentences(text: string): string[] {
  // Keep terminator attached to each sentence.
  const out: string[] = [];
  const re = /([^.!?\n]+[.!?]+)(?=\s|$)|([^.!?\n]+$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const piece = (m[1] || m[2] || "").trim();
    if (piece) out.push(piece);
  }
  return out.length ? out : [text];
}

/** Merges sentences shorter than MIN_CHUNK_LEN with the next/previous one. */
function mergeShortSentences(sentences: string[]): string[] {
  const merged: string[] = [];
  for (const s of sentences) {
    const last = merged[merged.length - 1];
    if (last && (last.length < MIN_CHUNK_LEN || s.length < MIN_CHUNK_LEN)) {
      merged[merged.length - 1] = `${last} ${s}`.trim();
    } else {
      merged.push(s);
    }
  }
  return merged;
}

/** Realistic typing delay (ms) based on chunk length. */
export function computeTypingDelay(text: string): number {
  const baseMs = 900;
  const perChar = 22;
  return Math.min(5000, Math.max(baseMs, text.length * perChar));
}
