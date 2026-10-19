import { z } from 'zod';
import { listNotes } from '../memory/notes.js';
import type { ToolDefinition } from './types.js';

// The reader's own notes. They surface no article ids, so they can never be
// cited as a source: they only tell an agent what the reader cares about.
const readNotes: ToolDefinition<Record<string, never>> = {
  spec: {
    name: 'read_notes',
    description:
      "Read the reader's own notes about their interests. Use them only to focus a search; they are not facts about the articles and cannot be cited.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  input: z.object({}).strict() as unknown as z.ZodType<Record<string, never>, z.ZodTypeDef, unknown>,
  async run() {
    const notes = await listNotes();
    return { content: JSON.stringify(notes.map((n) => n.text)), articleIds: [], resultCount: notes.length };
  },
};

export const NOTE_TOOLS: ToolDefinition<never>[] = [readNotes as ToolDefinition<never>];
