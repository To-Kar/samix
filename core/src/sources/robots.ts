import { SafeFetchError, safeFetch } from '../net/safeFetch.js';

// Minimal robots.txt support (RFC 9309 subset): groups by User-agent, Allow /
// Disallow with `*` and `$`, longest match wins, Allow wins ties. Used by the
// website crawler, which discovers pages on its own. (Opening one article the
// user asked to read is a browser-like action and doesn't consult it.)

export interface Robots {
  allows(pathAndQuery: string): boolean;
  sitemaps: string[];
}

const ALLOW_ALL: Robots = { allows: () => true, sitemaps: [] };
const DISALLOW_ALL: Robots = { allows: () => false, sitemaps: [] };

const AGENT = 'samix';

interface Rule {
  allow: boolean;
  re: RegExp;
  length: number;
}

function ruleRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

export function parseRobots(text: string): Robots {
  const sitemaps: string[] = [];
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'sitemap') {
      if (value) sitemaps.push(value);
    } else if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    } else if ((field === 'allow' || field === 'disallow') && current) {
      // An empty Disallow means "allow everything" and adds no rule.
      if (value) current.rules.push({ allow: field === 'allow', re: ruleRegex(value), length: value.length });
    }
    lastWasAgent = false;
  }

  const specific = groups.filter((g) => g.agents.includes(AGENT));
  const star = groups.filter((g) => g.agents.includes('*'));
  const rules = (specific.length ? specific : star).flatMap((g) => g.rules);

  return {
    sitemaps,
    allows(path) {
      let best: Rule | undefined;
      for (const r of rules) {
        if (!r.re.test(path)) continue;
        if (!best || r.length > best.length || (r.length === best.length && r.allow)) best = r;
      }
      return best ? best.allow : true;
    },
  };
}

export async function fetchRobots(origin: string): Promise<Robots> {
  try {
    const res = await safeFetch(`${origin}/robots.txt`, { maxBytes: 512 * 1024, timeoutMs: 8_000 });
    return parseRobots(res.body.toString('utf8'));
  } catch (err) {
    if (err instanceof SafeFetchError && err.code === 'http_error') {
      // 4xx: no robots.txt, everything allowed. 5xx: be careful, allow nothing.
      return (err.status ?? 0) >= 500 ? DISALLOW_ALL : ALLOW_ALL;
    }
    return ALLOW_ALL;
  }
}
