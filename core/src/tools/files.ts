import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import {
  MAX_READ_CHARS,
  listDir,
  readTextFile,
  resolveInProject,
  searchTree,
  type PathError,
} from '../projects/safePath.js';
import type { ToolDefinition, ToolResult } from './types.js';

// Read-only tools over the folders the reader released (spec 3b). Whatever a
// tool surfaces as a source is a file ref the answer may cite.

export const fileRef = (projectId: string, rel: string) => `file:${projectId}:${rel}`;

const json = (value: unknown): string => JSON.stringify(value);
const fail = (message: string): ToolResult => ({ content: json({ error: message }), articleIds: [], resultCount: 0, isError: true });

const PATH_ERRORS: Record<PathError, string> = {
  invalid_path: 'invalid path: use a relative path with "/" and without ".."',
  excluded: 'that path is excluded (secrets, VCS and dependency folders are never shown)',
  not_found: 'no such file or folder in this project',
  outside_project: 'that path leaves the project',
};

// Only projects the reader released for model access exist for the tools.
async function releasedProject(id: string) {
  const p = await prisma.project.findUnique({ where: { id } });
  return p?.allowModelAccess ? p : null;
}
const NO_PROJECT = 'unknown project (use an id from list_projects)';

const projectArg = z.string().trim().min(1).max(100);
const relPath = z.string().max(500);

const listProjects: ToolDefinition<Record<string, never>> = {
  spec: {
    name: 'list_projects',
    description: 'List the project folders the reader has released for reading. Use the returned id as `project` in the other tools.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  input: z.object({}).strict() as unknown as z.ZodType<Record<string, never>, z.ZodTypeDef, unknown>,
  async run() {
    const rows = await prisma.project.findMany({ where: { allowModelAccess: true }, orderBy: { name: 'asc' } });
    return { content: json(rows.map((r) => ({ id: r.id, name: r.name }))), articleIds: [], resultCount: rows.length };
  },
};

const listFilesInput = z.object({ project: projectArg, path: relPath.default('') }).strict();
const listFiles: ToolDefinition<z.infer<typeof listFilesInput>> = {
  spec: {
    name: 'list_files',
    description: 'List the files and folders in a project folder (not recursive). `path` is relative to the project root; empty means the root.',
    inputSchema: {
      type: 'object',
      properties: { project: { type: 'string' }, path: { type: 'string', description: 'Relative path, "/" separated.' } },
      required: ['project'],
      additionalProperties: false,
    },
  },
  input: listFilesInput as unknown as z.ZodType<z.infer<typeof listFilesInput>, z.ZodTypeDef, unknown>,
  async run(input) {
    const project = await releasedProject(input.project);
    if (!project) return fail(NO_PROJECT);
    const r = resolveInProject(project.path, input.path);
    if (!r.ok) return fail(PATH_ERRORS[r.error]);
    try {
      const { entries, truncated } = listDir(r.abs);
      return { content: json({ path: r.rel, entries, truncated }), articleIds: [], resultCount: entries.length };
    } catch {
      return fail('not a folder');
    }
  },
};

const searchInput = z.object({ project: projectArg, query: z.string().trim().min(1).max(100), path: relPath.default('') }).strict();
const searchFiles: ToolDefinition<z.infer<typeof searchInput>> = {
  spec: {
    name: 'search_files',
    description: 'Search text files of a project for a string (case-insensitive substring, not a regex). Returns file, line number and the matching line.',
    inputSchema: {
      type: 'object',
      properties: { project: { type: 'string' }, query: { type: 'string' }, path: { type: 'string', description: 'Limit to this folder (relative).' } },
      required: ['project', 'query'],
      additionalProperties: false,
    },
  },
  input: searchInput as unknown as z.ZodType<z.infer<typeof searchInput>, z.ZodTypeDef, unknown>,
  async run(input) {
    const project = await releasedProject(input.project);
    if (!project) return fail(NO_PROJECT);
    const base = resolveInProject(project.path, input.path);
    if (!base.ok) return fail(PATH_ERRORS[base.error]);
    let result;
    try {
      result = searchTree(base.abs, base.rel, input.query);
    } catch {
      return fail('not a folder');
    }
    const files = [...new Set(result.hits.map((h) => h.path))];
    return {
      content: json(result.hits.length ? { hits: result.hits.map((h) => ({ ...h, sourceId: fileRef(project.id, h.path) })), truncated: result.truncated, filesScanned: result.filesScanned } : { hits: [], note: 'no matches', filesScanned: result.filesScanned, truncated: result.truncated }),
      articleIds: files.map((f) => fileRef(project.id, f)),
      resultCount: result.hits.length,
    };
  },
};

const readInput = z
  .object({
    project: projectArg,
    path: relPath.min(1),
    startLine: z.number().int().min(1).default(1),
    maxLines: z.number().int().min(1).max(400).default(200),
  })
  .strict();
const readFile: ToolDefinition<z.infer<typeof readInput>> = {
  spec: {
    name: 'read_file',
    description: 'Read a text file of a project with line numbers. Long files are cut: use startLine to continue.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        path: { type: 'string' },
        startLine: { type: 'integer', minimum: 1 },
        maxLines: { type: 'integer', minimum: 1, maximum: 400 },
      },
      required: ['project', 'path'],
      additionalProperties: false,
    },
  },
  input: readInput as unknown as z.ZodType<z.infer<typeof readInput>, z.ZodTypeDef, unknown>,
  async run(input) {
    const project = await releasedProject(input.project);
    if (!project) return fail(NO_PROJECT);
    const r = resolveInProject(project.path, input.path);
    if (!r.ok) return fail(PATH_ERRORS[r.error]);
    let file;
    try {
      file = readTextFile(r.abs);
    } catch {
      return fail('cannot read this file');
    }
    if (!file.ok) {
      return fail(
        file.error === 'too_large' ? 'file too large to read' : file.error === 'binary' ? 'binary file; only text files can be read' : 'not a file'
      );
    }
    const lines = file.text.split('\n');
    const slice = lines.slice(input.startLine - 1, input.startLine - 1 + input.maxLines);
    let text = slice.map((l, i) => `${input.startLine + i}: ${l}`).join('\n');
    let cut = input.startLine - 1 + slice.length < lines.length;
    if (text.length > MAX_READ_CHARS) {
      text = `${text.slice(0, MAX_READ_CHARS)}…`;
      cut = true;
    }
    return {
      content: json({ path: r.rel, sourceId: fileRef(project.id, r.rel), totalLines: lines.length, startLine: input.startLine, truncated: cut, text }),
      articleIds: [fileRef(project.id, r.rel)],
      resultCount: 1,
    };
  },
};

export const FILE_TOOLS: ToolDefinition<never>[] = [
  listProjects as ToolDefinition<never>,
  listFiles as ToolDefinition<never>,
  searchFiles as ToolDefinition<never>,
  readFile as ToolDefinition<never>,
];
