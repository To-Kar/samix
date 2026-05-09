import type { ToolDefinition } from '../types.js';
import { prisma } from '../db/prisma.js';

export const saveMemoryTool: ToolDefinition = {
  name: 'save_memory',
  description:
    'Save a piece of information to persistent memory. Use this to remember user preferences, ' +
    'names, facts, or anything the user asks you to remember. Each key is unique — saving to ' +
    'an existing key updates it.',
  inputSchema: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'Short identifier for this memory (e.g. "user_name", "favorite_language")',
      },
      value: {
        type: 'string',
        description: 'The information to remember',
      },
      category: {
        type: 'string',
        description: 'Optional category (e.g. "preference", "fact", "task")',
      },
    },
    required: ['key', 'value'],
  },
  handler: async (input, ctx) => {
    const key = input.key as string;
    const value = input.value as string;
    const category = (input.category as string) || 'general';

    await prisma.memory.upsert({
      where: { key },
      create: { key, value, category },
      update: { value, category },
    });

    ctx.logger.info({ key, category }, 'memory_saved');
    return `Remembered: ${key} = ${value}`;
  },
};

export const recallMemoryTool: ToolDefinition = {
  name: 'recall_memory',
  description:
    'Retrieve information from persistent memory. Can look up a specific key or list all ' +
    'memories in a category. Use this to recall user preferences and previously saved facts.',
  inputSchema: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'Specific key to look up (omit to list by category)',
      },
      category: {
        type: 'string',
        description: 'Category to list all memories from (used when key is omitted)',
      },
    },
  },
  handler: async (input, ctx) => {
    const key = input.key as string | undefined;
    const category = input.category as string | undefined;

    if (key) {
      const mem = await prisma.memory.findUnique({ where: { key } });
      if (!mem) return `No memory found for key "${key}"`;
      return `${mem.key}: ${mem.value} (category: ${mem.category}, updated: ${mem.updatedAt.toISOString()})`;
    }

    const where = category ? { category } : {};
    const memories = await prisma.memory.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 50 });

    if (memories.length === 0) {
      return category ? `No memories in category "${category}"` : 'No memories stored yet.';
    }

    return memories
      .map((m) => `- ${m.key}: ${m.value}`)
      .join('\n');
  },
};
