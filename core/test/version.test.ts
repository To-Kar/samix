import { cpSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { disagreements, readVersions, setVersion } from '../../scripts/version.mjs';

const REPO = resolve(import.meta.dirname, '../..');
const FILES = ['package.json', 'app/package.json', 'core/package.json', 'app/src-tauri/tauri.conf.json', 'app/src-tauri/Cargo.toml', 'app/src-tauri/Cargo.lock', 'core/src/app.ts'];

function copyOfRepoFiles() {
  const root = mkdtempSync(join(tmpdir(), 'samix-version-'));
  for (const f of FILES) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    cpSync(join(REPO, f), join(root, f));
  }
  return root;
}

describe('one version for the whole repo', () => {
  it('is the same in every file that carries it (fails when someone bumps only one)', () => {
    expect(disagreements(REPO)).toEqual([]);
    expect(readVersions(REPO).every((r) => r.version && /^\d+\.\d+\.\d+/.test(r.version))).toBe(true);
  });

  it('sets all of them at once, including Cargo.lock, and touches nothing else', () => {
    const root = copyOfRepoFiles();
    const cargoBefore = readFileSync(join(root, 'app/src-tauri/Cargo.toml'), 'utf8');

    setVersion(root, '1.2.3-beta.1');

    expect(readVersions(root).map((r) => r.version)).toEqual(Array(6).fill('1.2.3-beta.1'));
    expect(disagreements(root, '1.2.3-beta.1')).toEqual([]);
    expect(readFileSync(join(root, 'app/src-tauri/Cargo.lock'), 'utf8')).toMatch(/name = "samix-app"\nversion = "1\.2\.3-beta\.1"/);
    // dependency versions in Cargo.toml stay as they were
    const cargoAfter = readFileSync(join(root, 'app/src-tauri/Cargo.toml'), 'utf8');
    expect(cargoAfter.replace('1.2.3-beta.1', '0.1.0')).toBe(cargoBefore.replace(/^version = "[^"]+"/m, 'version = "0.1.0"'));
    expect(JSON.parse(readFileSync(join(root, 'app/src-tauri/tauri.conf.json'), 'utf8')).identifier).toBe('app.samix');
  });

  it('refuses something that is not a version, and reports which file differs', () => {
    const root = copyOfRepoFiles();
    expect(() => setVersion(root, 'latest')).toThrow(/not a version/);
    expect(() => setVersion(root, '1.2')).toThrow(/not a version/);
    setVersion(root, '2.0.0');
    expect(disagreements(root, '2.0.1').length).toBe(6);
  });
});
