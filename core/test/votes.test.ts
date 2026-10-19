import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { buildReaderProfile } from '../src/runner/profile.js';
import { runAgent } from '../src/runner/runner.js';
import { logger } from '../src/logger.js';
import { fakeAdapter, llmOutput, makeSkill, respond, seedAgent, sourceItems, useAdapter, useRssItems } from './helpers.js';

const AUTH = { authorization: 'Bearer tok' };

async function article(agentId: string, title: string, topic?: string) {
  const run = await prisma.agentRun.create({ data: { agentId, status: 'success', trigger: 'manual' } });
  return prisma.article.create({ data: { agentRunId: run.id, title, summary: 's', topic, sourceUrl: `https://example.com/${title}` } });
}
const vote = (articleId: string, value: number) => prisma.articleVote.create({ data: { articleId, value } });

describe('buildReaderProfile', () => {
  it('is null without votes', async () => {
    const skill = makeSkill();
    expect(await buildReaderProfile(await seedAgent(skill))).toBeNull();
  });

  it('splits liked and disliked, newest vote first, limited per side, scoped to the agent', async () => {
    const mine = makeSkill();
    const other = makeSkill();
    const idMine = await seedAgent(mine);
    const idOther = await seedAgent(other);

    for (let i = 0; i < 12; i++) {
      const a = await article(idMine, `liked-${i}`, 'research');
      await prisma.articleVote.create({ data: { articleId: a.id, value: 1, updatedAt: new Date(2030, 0, 1, 0, i) } });
    }
    await vote((await article(idMine, 'disliked-0', 'gossip')).id, -1);
    await vote((await article(idOther, 'other-agent-like')).id, 1);

    const p = (await buildReaderProfile(idMine, 10))!;

    expect(p.liked).toHaveLength(10);
    expect(p.liked[0]).toEqual({ title: 'liked-11', topic: 'research' }); // most recent first
    expect(p.disliked).toEqual([{ title: 'disliked-0', topic: 'gossip' }]);
    expect(JSON.stringify(p)).not.toContain('other-agent-like');
  });

  it('truncates very long titles', async () => {
    const skill = makeSkill();
    const id = await seedAgent(skill);
    await vote((await article(id, 'x'.repeat(500))).id, 1);
    expect((await buildReaderProfile(id))!.liked[0]!.title).toHaveLength(120);
  });
});

describe('vote API', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let slug: string;
  let agentId: string;
  beforeAll(async () => {
    const skill = makeSkill();
    slug = skill.id;
    agentId = await seedAgent(skill);
    app = await buildApp({ token: 'tok', logger, getSkills: () => [skill] });
  });
  const put = (id: string, payload: unknown) =>
    app.inject({ method: 'PUT', url: `/articles/${id}/vote`, headers: AUTH, payload: payload as object });

  it('sets, replaces and clears a vote; it shows up in the edition and the article', async () => {
    const run = await prisma.agentRun.create({ data: { agentId, status: 'success', trigger: 'manual' } });
    const a = await prisma.article.create({ data: { agentRunId: run.id, title: 'v', summary: 's' } });

    expect((await put(a.id, { value: 1 })).json()).toEqual({ vote: 1 });
    expect((await app.inject({ url: `/articles/${a.id}`, headers: AUTH })).json().vote).toBe(1);
    expect((await app.inject({ url: `/editions/${run.id}`, headers: AUTH })).json().articles[0].vote).toBe(1);

    expect((await put(a.id, { value: -1 })).json()).toEqual({ vote: -1 });
    expect(await prisma.articleVote.count({ where: { articleId: a.id } })).toBe(1); // replaced, not added

    expect((await put(a.id, { value: 0 })).json()).toEqual({ vote: null });
    expect((await app.inject({ url: `/articles/${a.id}`, headers: AUTH })).json().vote).toBeNull();
  });

  it('rejects bad values and unknown articles; needs auth', async () => {
    const run = await prisma.agentRun.create({ data: { agentId, status: 'success', trigger: 'manual' } });
    const a = await prisma.article.create({ data: { agentRunId: run.id, title: 'v2', summary: 's' } });
    for (const value of [2, '1', null, undefined]) {
      expect((await put(a.id, { value })).statusCode, String(value)).toBe(400);
    }
    expect((await put('nope', { value: 1 })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PUT', url: `/articles/${a.id}/vote`, payload: { value: 1 } })).statusCode).toBe(401);
  });

  it('shows the profile and resets it for one agent only', async () => {
    const run = await prisma.agentRun.create({ data: { agentId, status: 'success', trigger: 'manual' } });
    const a = await prisma.article.create({ data: { agentRunId: run.id, title: 'keep-me-liked', summary: 's' } });
    await put(a.id, { value: 1 });

    const shown = (await app.inject({ url: `/profile?agent=${slug}`, headers: AUTH })).json();
    expect(shown.profile.liked.map((e: { title: string }) => e.title)).toContain('keep-me-liked');

    const del = await app.inject({ method: 'DELETE', url: `/votes?agent=${slug}`, headers: AUTH });
    expect(del.json().deleted).toBeGreaterThan(0);
    expect((await app.inject({ url: `/profile?agent=${slug}`, headers: AUTH })).json().profile).toBeNull();

    expect((await app.inject({ url: '/profile', headers: AUTH })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: '/votes?agent=nope', headers: AUTH })).statusCode).toBe(404);
  });
});

describe('personalised runs', () => {
  const setup = async (personalize: boolean | undefined) => {
    const items = sourceItems(7);
    useRssItems(items);
    const claude = fakeAdapter('claude-haiku-4-5', async () => respond(llmOutput(items.slice(0, 5).map((i) => i.url))));
    useAdapter(claude);
    const skill = makeSkill();
    skill.manifest.personalize = personalize;
    skill.manifest.dedupeDays = 0;
    const agentId = await seedAgent(skill);
    return { skill, claude, agentId };
  };
  const sentMessage = (claude: ReturnType<typeof fakeAdapter>) =>
    JSON.parse(claude.generate.mock.calls[0]![0].messages[0].content) as Record<string, unknown>;

  it('attaches the profile when enabled and votes exist', async () => {
    const { skill, claude, agentId } = await setup(true);
    await vote((await article(agentId, 'I liked this', 'research')).id, 1);
    await vote((await article(agentId, 'I disliked this')).id, -1);

    await runAgent({ skill, trigger: 'manual', logger });

    expect(sentMessage(claude).readerProfile).toEqual({
      liked: [{ title: 'I liked this', topic: 'research' }],
      disliked: [{ title: 'I disliked this' }],
    });
  });

  it('sends nothing personal when the agent has not opted in', async () => {
    const { skill, claude, agentId } = await setup(false);
    await vote((await article(agentId, 'secret like')).id, 1);
    await runAgent({ skill, trigger: 'manual', logger });
    expect(sentMessage(claude)).not.toHaveProperty('readerProfile');
    expect(JSON.stringify(claude.generate.mock.calls[0]![0])).not.toContain('secret like');
  });

  it('leaves the message unchanged when there are no votes', async () => {
    const { skill, claude } = await setup(true);
    await runAgent({ skill, trigger: 'manual', logger });
    expect(Object.keys(sentMessage(claude))).toEqual(['items']);
  });
});
