import { prisma } from '../db/prisma.js';
import { listNotes } from '../memory/notes.js';

// What the reader has said about this agent's articles, in a form a model can
// use to rank importance. Deliberately plain and inspectable: the UI shows
// exactly this (GET /profile), and it is the only personal data a run sends.
// Titles are the agent's own rewritten titles of public articles. `interests`
// are the reader's notes (memory/notes.ts), so they leave the machine only for
// an agent with `personalize: true`, and /profile shows exactly this.

export interface ProfileEntry {
  title: string;
  topic?: string;
}

export interface ReaderProfile {
  liked: ProfileEntry[];
  disliked: ProfileEntry[];
  /** The reader's own notes (newest first); only present if there are any. */
  interests?: string[];
}

export const DEFAULT_PROFILE_EXAMPLES = 10;
const MAX_TITLE_CHARS = 120;
export const MAX_INTERESTS = 20;
const MAX_INTEREST_CHARS = 200;

export async function buildReaderProfile(
  agentId: string,
  perSide = DEFAULT_PROFILE_EXAMPLES
): Promise<ReaderProfile | null> {
  const votes = await prisma.articleVote.findMany({
    where: { article: { agentRun: { agentId } } },
    orderBy: { updatedAt: 'desc' },
    include: { article: { select: { title: true, topic: true } } },
  });

  const entry = (v: (typeof votes)[number]): ProfileEntry => ({
    title: v.article.title.slice(0, MAX_TITLE_CHARS),
    ...(v.article.topic ? { topic: v.article.topic } : {}),
  });
  const liked = votes.filter((v) => v.value > 0).slice(0, perSide).map(entry);
  const disliked = votes.filter((v) => v.value < 0).slice(0, perSide).map(entry);

  // The reader's notes travel with the votes: both are what the reader chose to tell Samix.
  const interests = (await listNotes()).slice(0, MAX_INTERESTS).map((n) => n.text.slice(0, MAX_INTEREST_CHARS));

  if (liked.length + disliked.length + interests.length === 0) return null;
  return { liked, disliked, ...(interests.length ? { interests } : {}) };
}
