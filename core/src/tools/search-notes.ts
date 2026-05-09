import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname, relative } from 'node:path';
import type { ToolDefinition } from '../types.js';

const EXTENSIONS = new Set(['.md', '.txt', '.org', '.rst']);
const MAX_RESULTS = 8;
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;

async function walkDir(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDir(full)));
    } else if (EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      files.push(full);
    }
  }
  return files;
}

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
  }
  return chunks;
}

interface ScoredChunk {
  file: string;
  chunk: string;
  score: number;
}

function searchChunks(
  files: Array<{ path: string; content: string }>,
  query: string,
  baseDir: string
): ScoredChunk[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results: ScoredChunk[] = [];

  for (const f of files) {
    const chunks = chunkText(f.content);
    for (const chunk of chunks) {
      const lower = chunk.toLowerCase();
      let score = 0;
      for (const term of terms) {
        const idx = lower.indexOf(term);
        if (idx !== -1) score++;
      }
      if (score > 0) {
        results.push({ file: relative(baseDir, f.path), chunk, score });
      }
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, MAX_RESULTS);
}

export const searchNotesTool: ToolDefinition = {
  name: 'search_notes',
  description:
    'Search the user\'s local notes/documents directory for content matching a query. ' +
    'Returns relevant text chunks from markdown, text, and org files. ' +
    'Set SAMIX_NOTES_DIR env var to configure the notes directory.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query — keywords or natural language',
      },
    },
    required: ['query'],
  },
  handler: async (input, ctx) => {
    const query = input.query as string;
    const notesDir = process.env.SAMIX_NOTES_DIR;

    if (!notesDir) {
      return 'SAMIX_NOTES_DIR not configured — cannot search notes.';
    }

    try {
      await stat(notesDir);
    } catch {
      return `Notes directory not found: ${notesDir}`;
    }

    ctx.logger.info({ query, dir: notesDir }, 'searching notes');

    const paths = await walkDir(notesDir);
    if (paths.length === 0) {
      return 'No note files found in the configured directory.';
    }

    const files = await Promise.all(
      paths.map(async (p) => ({
        path: p,
        content: await readFile(p, 'utf-8'),
      }))
    );

    const matches = searchChunks(files, query, notesDir);
    if (matches.length === 0) {
      return `No matches found for "${query}" in ${paths.length} files.`;
    }

    const formatted = matches
      .map((m) => `--- ${m.file} (relevance: ${m.score}) ---\n${m.chunk.trim()}`)
      .join('\n\n');

    return `Found ${matches.length} relevant chunks from ${paths.length} files:\n\n${formatted}`;
  },
};
