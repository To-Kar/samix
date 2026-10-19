// The topic sentence of a template-based agent: the text between the
// <!-- focus --> markers in its SKILL.md (see skills/create.ts).
const FOCUS = /<!-- focus -->([\s\S]*?)<!-- \/focus -->/;

export function focusOf(systemPrompt: string): string | undefined {
  const m = FOCUS.exec(systemPrompt);
  const text = m?.[1]?.replace(/\s+/g, ' ').trim();
  return text || undefined;
}
