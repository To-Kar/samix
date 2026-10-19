import { prisma } from '../db/prisma.js';

// The reader's notes: plain text, written only by the reader, shown in full in
// the UI. Agents see them only through the read_notes tool.

export const MAX_NOTES = 100;
export const MAX_NOTE_CHARS = 500;

export type AddNoteResult = { ok: true; note: { id: string; text: string; createdAt: Date } } | { ok: false; error: 'invalid_text' | 'too_many_notes' };

export function listNotes() {
  return prisma.memoryNote.findMany({ orderBy: { createdAt: 'desc' } });
}

export async function addNote(raw: string): Promise<AddNoteResult> {
  const text = raw.trim();
  if (!text || text.length > MAX_NOTE_CHARS) return { ok: false, error: 'invalid_text' };
  if ((await prisma.memoryNote.count()) >= MAX_NOTES) return { ok: false, error: 'too_many_notes' };
  return { ok: true, note: await prisma.memoryNote.create({ data: { text } }) };
}

export async function deleteNote(id: string): Promise<boolean> {
  return (await prisma.memoryNote.deleteMany({ where: { id } })).count > 0;
}
