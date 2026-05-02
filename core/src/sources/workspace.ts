import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve as resolvePath, extname } from 'node:path';
import { homedir } from 'node:os';
import type { FetchContext, SourceFetcher, SourceItem } from '../types.js';

interface WorkspaceConfig {
  path: string;
  include?: string[];     // file extensions to include, e.g. ["**/*.ts", "**/*.md"]
  maxFileSizeKb?: number; // default 80
  maxTotalKb?: number;    // default 300
}

// Directories that are never useful as coding context.
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  'target',
]);

function matchesInclude(filePath: string, include: string[]): boolean {
  const ext = extname(filePath);
  return include.some((pattern) => {
    // Support both "**/*.ts" globs and bare ".ts" / "ts" extensions.
    const suffix = pattern.replace(/^\*+\/?\*?/, '').replace(/^\*\./, '.');
    return ext === suffix || filePath.endsWith(suffix);
  });
}

async function collectFiles(
  dir: string,
  include: string[],
  maxBytes: number
): Promise<string[]> {
  const results: string[] = [];

  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          await walk(full);
        }
      } else if (entry.isFile()) {
        if (matchesInclude(entry.name, include)) {
          try {
            const s = await stat(full);
            if (s.size <= maxBytes) results.push(full);
          } catch {
            // skip unreadable
          }
        }
      }
    }
  }

  await walk(dir);
  return results;
}

export class WorkspaceFetcher implements SourceFetcher {
  readonly type = 'workspace' as const;

  async fetch(config: WorkspaceConfig, ctx: FetchContext): Promise<SourceItem[]> {
    const rootPath = config.path.startsWith('~')
      ? config.path.replace(/^~/, homedir())
      : resolvePath(config.path);

    const maxFileBytes = (config.maxFileSizeKb ?? 80) * 1024;
    const maxTotalBytes = (config.maxTotalKb ?? 300) * 1024;
    const include = config.include ?? ['**/*.ts', '**/*.md', '**/*.py', '**/*.rs'];

    let files: string[];
    try {
      files = await collectFiles(rootPath, include, maxFileBytes);
    } catch (err) {
      ctx.logger.warn({ err, path: rootPath }, 'workspace_collect_failed');
      return [];
    }

    const items: SourceItem[] = [];
    let totalBytes = 0;

    for (const filePath of files) {
      if (totalBytes >= maxTotalBytes) break;
      try {
        const content = await readFile(filePath, 'utf8');
        const relPath = relative(rootPath, filePath);
        const bytes = Buffer.byteLength(content, 'utf8');
        if (totalBytes + bytes > maxTotalBytes) continue;
        totalBytes += bytes;
        items.push({
          url: relPath,
          title: relPath,
          snippet: content.slice(0, 200),
          sourceName: 'workspace',
          // raw is intentionally null: file content lives on disk.
          // The relative path in url/title is sufficient for traceability.
        });
      } catch {
        ctx.logger.debug({ filePath }, 'workspace_file_skipped');
      }
    }

    ctx.logger.info(
      { files: items.length, totalKb: Math.round(totalBytes / 1024), root: rootPath },
      'workspace_fetched'
    );
    return items;
  }
}
