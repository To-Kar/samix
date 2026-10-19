import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rotateLog } from '../src/log-rotate.js';
import { seedAgents } from '../src/skills/seed.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'samix-seed-'));
const put = (path: string, text: string) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
};

describe('seedAgents', () => {
  it('copies missing agents (with all files), ignores _/. entries, never overwrites edits', () => {
    const bundled = tmp();
    const user = join(tmp(), 'agents');
    put(join(bundled, 'news', 'manifest.yaml'), 'bundled news');
    put(join(bundled, 'news', 'schema.json'), '{}');
    put(join(bundled, 'hello', 'manifest.yaml'), 'bundled hello');
    put(join(bundled, '_registry.yaml'), 'x');
    put(join(bundled, '.hidden', 'manifest.yaml'), 'x');
    put(join(user, 'hello', 'manifest.yaml'), 'EDITED BY USER');

    const copied = seedAgents(bundled, user);

    expect(copied).toEqual(['news']);
    expect(readFileSync(join(user, 'news', 'schema.json'), 'utf8')).toBe('{}');
    expect(readFileSync(join(user, 'hello', 'manifest.yaml'), 'utf8')).toBe('EDITED BY USER');
    expect(readdirSync(user).sort()).toEqual(['hello', 'news']);
    // idempotent
    expect(seedAgents(bundled, user)).toEqual([]);
  });

  it('creates the user folder when it does not exist yet', () => {
    const bundled = tmp();
    put(join(bundled, 'a', 'manifest.yaml'), 'a');
    const user = join(tmp(), 'deep', 'agents');
    expect(seedAgents(bundled, user)).toEqual(['a']);
  });
});

describe('rotateLog', () => {
  it('leaves small and missing files alone', () => {
    const dir = tmp();
    rotateLog(join(dir, 'core.log'), 100);
    put(join(dir, 'core.log'), 'small');
    rotateLog(join(dir, 'core.log'), 100);
    expect(readdirSync(dir)).toEqual(['core.log']);
  });

  it('rotates to .1, then .2, and drops the oldest beyond `keep`', () => {
    const dir = tmp();
    const log = join(dir, 'core.log');
    for (const gen of ['one', 'two', 'three']) {
      put(log, gen.padEnd(200, '.'));
      rotateLog(log, 100, 2);
    }
    expect(readdirSync(dir).sort()).toEqual(['core.log.1', 'core.log.2']);
    expect(readFileSync(`${log}.1`, 'utf8').startsWith('three')).toBe(true);
    expect(readFileSync(`${log}.2`, 'utf8').startsWith('two')).toBe(true);
  });
});
