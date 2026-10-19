import type { RunResult, Skill } from '../types.js';

// Lets other parts of the core react to a finished run without the runner
// knowing about them (and without tests triggering real network work).

export type RunSuccessHandler = (result: RunResult, skill: Skill) => void | Promise<void>;

const handlers: RunSuccessHandler[] = [];

export function onRunSuccess(handler: RunSuccessHandler): void {
  handlers.push(handler);
}

export function notifyRunSuccess(result: RunResult, skill: Skill, onError: (err: unknown) => void): void {
  for (const h of handlers) {
    void Promise.resolve()
      .then(() => h(result, skill))
      .catch(onError);
  }
}
