import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { logger } from '../src/logger.js';
import { runAgent } from '../src/runner/runner.js';
import { ARTICLE_LANGUAGE_KEY, deleteSetting } from '../src/settings.js';
import { fakeAdapter, llmOutput, makeSkill, respond, seedAgent, sourceItems, useAdapter, useRssItems } from './helpers.js';

const AUTH = { authorization: 'Bearer tok' };
afterEach(() => deleteSetting(ARTICLE_LANGUAGE_KEY));

const app = () => buildApp({ token: 'tok', logger, getSkills: () => [] });

async function runOnce() {
  const items = sourceItems(6);
  useRssItems(items);
  const claude = fakeAdapter('claude-haiku-4-5', async () => respond(llmOutput(items.slice(0, 5).map((i) => i.url))));
  useAdapter(claude);
  const skill = makeSkill();
  skill.manifest.dedupeDays = 0;
  await seedAgent(skill);
  await runAgent({ skill, trigger: 'manual', logger });
  return { skill, sentSystem: claude.generate.mock.calls[0]![0].systemPrompt as string };
}

describe('article language', () => {
  it('is stored through the API and validated', async () => {
    const a = await app();
    expect((await a.inject({ url: '/settings/article-language', headers: AUTH })).json()).toEqual({ language: null });
    const put = (payload: object) => a.inject({ method: 'PUT', url: '/settings/article-language', headers: AUTH, payload });
    expect((await put({ language: 'de' })).json()).toEqual({ language: 'de' });
    expect((await a.inject({ url: '/settings/article-language', headers: AUTH })).json()).toEqual({ language: 'de' });
    expect((await put({ language: 'fr' })).statusCode).toBe(400);
    expect((await put({})).statusCode).toBe(400);
    expect((await a.inject({ method: 'DELETE', url: '/settings/article-language', headers: AUTH })).json()).toEqual({ language: null });
  });

  it('changes nothing in the prompt while unset', async () => {
    const { skill, sentSystem } = await runOnce();
    expect(sentSystem).toBe(skill.systemPrompt);
  });

  it('adds the instruction for the next run, in the chosen language, after the skill prompt', async () => {
    const a = await app();
    await a.inject({ method: 'PUT', url: '/settings/article-language', headers: AUTH, payload: { language: 'de' } });
    const de = await runOnce();
    expect(de.sentSystem.startsWith(de.skill.systemPrompt)).toBe(true);
    expect(de.sentSystem).toContain('in German');

    await a.inject({ method: 'PUT', url: '/settings/article-language', headers: AUTH, payload: { language: 'en' } });
    const en = await runOnce();
    expect(en.sentSystem).toContain('in English');
    expect(en.sentSystem).not.toContain('in German');
  });
});
