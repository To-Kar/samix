// LLMs routinely wrap JSON in ```json ... ``` fences (or bare ``` fences)
// even when instructed not to. Strip them defensively so the validator
// sees clean JSON. Returns the input unchanged if no fences detected.
export function unwrapJsonFences(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json|JSON)?\s*\n([\s\S]*?)\n```\s*$/);
  const inner = match?.[1];
  return inner === undefined ? raw : inner.trim();
}
