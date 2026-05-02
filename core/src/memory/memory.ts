import { prisma } from '../db/prisma.js';

export interface MemoryEntry {
  key: string;
  content: string;
}

export async function getMemory(agentSlug: string, key: string): Promise<string | null> {
  const row = await prisma.memory.findUnique({
    where: { agentSlug_key: { agentSlug, key } },
    select: { content: true },
  });
  return row?.content ?? null;
}

export async function setMemory(agentSlug: string, key: string, content: string): Promise<void> {
  await prisma.memory.upsert({
    where: { agentSlug_key: { agentSlug, key } },
    create: { agentSlug, key, content },
    update: { content },
  });
}

export async function listMemories(agentSlug: string): Promise<MemoryEntry[]> {
  return prisma.memory.findMany({
    where: { agentSlug },
    orderBy: { updatedAt: 'desc' },
    select: { key: true, content: true },
  });
}

export async function deleteMemory(agentSlug: string, key: string): Promise<void> {
  await prisma.memory.delete({
    where: { agentSlug_key: { agentSlug, key } },
  });
}
