// Splits an answer into text and [n] source references. The answer is plain
// text from the model: it is rendered as React text, never as HTML.

export type AnswerPart = { text: string } | { ref: number };

export function splitAnswer(answer: string, knownRefs: ReadonlySet<number>): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let last = 0;
  for (const m of answer.matchAll(/\[(\d+)\]/g)) {
    const n = Number(m[1]);
    if (!knownRefs.has(n)) continue; // not a source marker: leave the text as it is
    if (m.index > last) parts.push({ text: answer.slice(last, m.index) });
    parts.push({ ref: n });
    last = m.index + m[0].length;
  }
  if (last < answer.length) parts.push({ text: answer.slice(last) });
  return parts;
}
