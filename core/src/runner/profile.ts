import { prisma } from '../db/prisma.js';

// What the reader has said about this agent's articles, in a form a model can
// use to rank importance. Deliberately plain and inspectable: the UI shows
// exactly this (GET /profile), and it is the only personal data a run sends.
// Titles are the agent's own rewritten titles of public articles.

export interface ProfileEntry {
  title: string;
  topic?: string;
}

export interface ReaderProfile {
  liked: ProfileEntry[];
  disliked: ProfileEntry[];
}

export const DEFAULT_PROFILE_EXAMPLES = 10;
const MAX_TITLE_CHARS = 120;

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

  return liked.length + disliked.length === 0 ? null : { liked, disliked };
}
