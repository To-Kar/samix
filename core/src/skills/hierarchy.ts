import type { Logger } from 'pino';
import type { Skill } from '../types.js';

// Agents can hand a question to other agents (`delegates:` in the manifest), and
// those may hand it on, so the manifests together describe a tree. This checks
// it once at load time; the runner checks the path again at run time
// (runner/orchestrate.ts), because the files are the reader's to edit.

export const MAX_DELEGATION_DEPTH = 3;

export type DelegationProblem = 'unknown_agent' | 'not_reactive' | 'cycle' | 'too_deep';

export interface DelegationIssue {
  agent: string;
  delegate: string;
  problem: DelegationProblem;
}

// Removes every `delegates:` entry that points at a missing or non-reactive
// agent, closes a cycle, or would make a chain longer than MAX_DELEGATION_DEPTH
// agents. The agent itself still loads: a typo must not take the app down.
// Entries are checked in manifest order, so the first edge that breaks a rule
// is the one dropped.
export function validateDelegation(skills: Skill[], log?: Logger): DelegationIssue[] {
  const byId = new Map(skills.map((s) => [s.id, s]));
  const issues: DelegationIssue[] = [];
  const drop = (from: Skill, delegate: string, problem: DelegationProblem) => {
    issues.push({ agent: from.id, delegate, problem });
    from.manifest.delegates = (from.manifest.delegates ?? []).filter((d) => d !== delegate);
    if (from.manifest.delegates.length === 0) from.manifest.delegates = undefined;
    log?.warn({ agent: from.id, delegate, problem }, 'delegation_invalid');
  };

  // Longest chain (in agents) that starts at `id` through the edges kept so far.
  const height = (id: string, seen: Set<string>): number => {
    const s = byId.get(id);
    if (!s || seen.has(id)) return 0;
    const next = new Set(seen).add(id);
    return 1 + Math.max(0, ...(s.manifest.delegates ?? []).map((d) => height(d, next)));
  };
  // Does `target` reach `from` through the edges kept so far?
  const reaches = (target: string, from: string, seen = new Set<string>()): boolean => {
    if (target === from) return true;
    if (seen.has(target)) return false;
    seen.add(target);
    return (byId.get(target)?.manifest.delegates ?? []).some((d) => reaches(d, from, seen));
  };

  // Everything an agent points at must exist and be able to answer. Done first
  // so the cycle and depth checks only walk real edges.
  for (const s of skills) {
    for (const d of [...(s.manifest.delegates ?? [])]) {
      const target = byId.get(d);
      if (!target) drop(s, d, 'unknown_agent');
      else if (target.type !== 'reactive') drop(s, d, 'not_reactive');
    }
  }

  // Edges are added back one at a time into an empty graph, so the first edge
  // that would break a rule is the one dropped and the order is the manifest's.
  const declared = skills.map((s) => ({ s, delegates: s.manifest.delegates ?? [] }));
  for (const { s } of declared) s.manifest.delegates = undefined;
  for (const { s, delegates } of declared) {
    for (const d of delegates) {
      if (reaches(d, s.id)) {
        issues.push({ agent: s.id, delegate: d, problem: 'cycle' });
        log?.warn({ agent: s.id, delegate: d, problem: 'cycle' }, 'delegation_invalid');
        continue;
      }
      s.manifest.delegates = [...(s.manifest.delegates ?? []), d];
      // The new edge may lengthen chains through `s` too, not only below it.
      if (skills.some((root) => height(root.id, new Set()) > MAX_DELEGATION_DEPTH)) {
        s.manifest.delegates = s.manifest.delegates.filter((x) => x !== d);
        if (s.manifest.delegates.length === 0) s.manifest.delegates = undefined;
        issues.push({ agent: s.id, delegate: d, problem: 'too_deep' });
        log?.warn({ agent: s.id, delegate: d, problem: 'too_deep' }, 'delegation_invalid');
      }
    }
  }
  return issues;
}
