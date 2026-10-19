import { lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, parse, sep } from 'node:path';

// Everything the project assistant may touch goes through here. A project is a
// folder the reader released; paths are relative to it and must stay inside it
// (docs/SAMIX_PHASE_3B_SPEC.md §3). Read-only: nothing in this file writes.

export const MAX_FILE_BYTES = 500_000;
export const MAX_SEARCH_FILE_BYTES = 1_000_000;
export const MAX_READ_CHARS = 8000;
export const MAX_LIST_ENTRIES = 200;
export const MAX_SEARCH_HITS = 20;
export const MAX_SEARCH_FILES = 2000;

const EXCLUDED_DIRS = new Set(['.git', 'node_modules', '.ssh', '.gnupg', '.aws', '.kube']);
const EXCLUDED_FILES = [
  /^\.env(\..*)?$/i,
  /\.(pem|key|p12|pfx|jks|keystore)$/i,
  /^id_(rsa|ed25519|dsa|ecdsa)/i,
  /^credentials/i,
];

// Hidden from listings and searches, and refused when asked for by name.
export function isExcludedName(name: string, isDir: boolean): boolean {
  return isDir ? EXCLUDED_DIRS.has(name) : EXCLUDED_FILES.some((re) => re.test(name)) || EXCLUDED_DIRS.has(name);
}

export type PathError = 'invalid_path' | 'excluded' | 'not_found' | 'outside_project';

export type Resolved = { ok: true; abs: string; rel: string } | { ok: false; error: PathError };

// `rel` is what the model sent. Returns the real absolute path only if it is
// inside the project's real root.
export function resolveInProject(root: string, rel: string): Resolved {
  if (rel.includes('\0') || rel.includes('\\') || isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) {
    return { ok: false, error: 'invalid_path' };
  }
  const segments = rel.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.some((s) => s === '..')) return { ok: false, error: 'invalid_path' };
  for (const [i, s] of segments.entries()) {
    if (isExcludedName(s, i < segments.length - 1)) return { ok: false, error: 'excluded' };
  }
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    return { ok: false, error: 'not_found' };
  }
  let real: string;
  try {
    real = realpathSync(join(realRoot, ...segments));
  } catch {
    return { ok: false, error: 'not_found' };
  }
  if (real !== realRoot && !real.startsWith(realRoot + sep)) return { ok: false, error: 'outside_project' };
  // A symlink inside the project that points to an excluded file must not be a way around the exclusions.
  const realSegments = real.slice(realRoot.length).split(sep).filter(Boolean);
  for (const [i, s] of realSegments.entries()) {
    if (isExcludedName(s, i < realSegments.length - 1)) return { ok: false, error: 'excluded' };
  }
  return { ok: true, abs: real, rel: segments.join('/') };
}

// Folders that are too broad to release: the filesystem root and the home folder itself.
export function validateProjectRoot(path: string): { ok: true; real: string } | { ok: false; error: 'invalid_path' | 'not_a_directory' | 'too_broad' } {
  if (!path || path.includes('\0') || !isAbsolute(path)) return { ok: false, error: 'invalid_path' };
  let real: string;
  try {
    real = realpathSync(path);
    if (!statSync(real).isDirectory()) return { ok: false, error: 'not_a_directory' };
  } catch {
    return { ok: false, error: 'not_a_directory' };
  }
  let home: string | null = null;
  try {
    home = realpathSync(homedir());
  } catch {
    home = null;
  }
  if (real === parse(real).root || real === home) return { ok: false, error: 'too_broad' };
  return { ok: true, real };
}

export interface DirEntry {
  name: string;
  type: 'dir' | 'file';
  bytes?: number;
}

// Entries of one directory, without symlinks and excluded names.
export function listDir(abs: string): { entries: DirEntry[]; truncated: boolean } {
  const out: DirEntry[] = [];
  for (const d of readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (d.isSymbolicLink()) continue;
    const dir = d.isDirectory();
    if (!dir && !d.isFile()) continue;
    if (isExcludedName(d.name, dir)) continue;
    out.push(dir ? { name: d.name, type: 'dir' } : { name: d.name, type: 'file', bytes: lstatSync(join(abs, d.name)).size });
  }
  return { entries: out.slice(0, MAX_LIST_ENTRIES), truncated: out.length > MAX_LIST_ENTRIES };
}

export type ReadResult = { ok: true; text: string } | { ok: false; error: 'too_large' | 'binary' | 'not_a_file' };

// Whole file as text; refuses binary and large files.
export function readTextFile(abs: string, maxBytes = MAX_FILE_BYTES): ReadResult {
  const st = statSync(abs);
  if (!st.isFile()) return { ok: false, error: 'not_a_file' };
  if (st.size > maxBytes) return { ok: false, error: 'too_large' };
  const buf = readFileSync(abs);
  if (buf.subarray(0, 8000).includes(0)) return { ok: false, error: 'binary' };
  return { ok: true, text: buf.toString('utf8') };
}

export interface SearchHit {
  path: string;
  line: number;
  text: string;
}

// Case-insensitive substring search over text files below `abs`.
export function searchTree(abs: string, relBase: string, query: string): { hits: SearchHit[]; filesScanned: number; truncated: boolean } {
  const needle = query.toLowerCase();
  const hits: SearchHit[] = [];
  let filesScanned = 0;
  let truncated = false;
  const walk = (dirAbs: string, dirRel: string): void => {
    if (truncated) return;
    for (const d of readdirSync(dirAbs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (truncated) return;
      if (d.isSymbolicLink()) continue;
      const rel = dirRel ? `${dirRel}/${d.name}` : d.name;
      if (d.isDirectory()) {
        if (!isExcludedName(d.name, true)) walk(join(dirAbs, d.name), rel);
      } else if (d.isFile() && !isExcludedName(d.name, false)) {
        if (filesScanned >= MAX_SEARCH_FILES) {
          truncated = true;
          return;
        }
        filesScanned++;
        const r = readTextFile(join(dirAbs, d.name), MAX_SEARCH_FILE_BYTES);
        if (!r.ok) continue;
        const lines = r.text.split('\n');
        for (const [i, line] of lines.entries()) {
          if (line.toLowerCase().includes(needle)) {
            hits.push({ path: rel, line: i + 1, text: line.trim().slice(0, 200) });
            if (hits.length >= MAX_SEARCH_HITS) {
              truncated = true;
              return;
            }
          }
        }
      }
    }
  };
  walk(abs, relBase);
  return { hits, filesScanned, truncated };
}
