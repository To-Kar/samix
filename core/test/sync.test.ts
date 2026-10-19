import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import matter from 'gray-matter';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { logger } from '../src/logger.js';
import { createAgent } from '../src/skills/create.js';
import { loadSkillDir } from '../src/skills/loader.js';
import { compareVersions, syncShippedAgents } from '../src/skills/sync.js';

const REPO_AGENTS = resolve(import.meta.dirname, '../../agents');
const tmp = () => mkdtempSync(join(tmpdir(), 'samix-sync-'));

// A "shipped" folder with a newer prompt than the user's copy, so each test controls both sides.
function shipped(version = '2.0') {
  const dir = tmp();
  for (const a of ['newsletter-ai', 'orchestrator', 'frag-die-zeitung']) cpSync(join(REPO_AGENTS, a), join(dir, a), { recursive: true });
  for (const a of ['newsletter-ai', 'orchestrator', 'frag-die-zeitung']) {
    const p = join(dir, a, 'manifest.yaml');
    const m = parseYaml(readFileSync(p, 'utf8')) as Record<string, unknown>;
    m['version'] = version;
    writeFileSync(p, stringifyYaml(m));
  }
  return dir;
}

const manifestOf = (dir: string, a: string) => parseYaml(readFileSync(join(dir, a, 'manifest.yaml'), 'utf8')) as Record<string, any>;

// The user's copy as an older install left it: old prompt and schema, plus their own edits.
function oldCopy(userDir: string, agent: string, edit: (m: Record<string, any>) => void = () => undefined) {
  cpSync(join(REPO_AGENTS, agent), join(userDir, agent), { recursive: true });
  const mp = join(userDir, agent, 'manifest.yaml');
  const m = parseYaml(readFileSync(mp, 'utf8')) as Record<string, any>;
  m['version'] = '1.0';
  edit(m);
  writeFileSync(mp, stringifyYaml(m));
  const sp = join(userDir, agent, 'SKILL.md');
  const sk = matter(readFileSync(sp, 'utf8'));
  writeFileSync(sp, matter.stringify('OLD PROMPT BODY', { ...sk.data, title: 'Mein Titel' }));
  writeFileSync(join(userDir, agent, 'schema.json'), '{"old":true}');
}

describe('compareVersions', () => {
  it('compares numerically per segment', () => {
    expect(compareVersions('1.10', '1.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.1', '2.0')).toBeLessThan(0);
    expect(compareVersions('x', '1')).toBeLessThan(0);
  });
});

describe('syncShippedAgents', () => {
  it('brings prompt, schema and capability keys forward and keeps everything the user edited', async () => {
    const bundled = shipped();
    const user = tmp();
    oldCopy(user, 'newsletter-ai', (m) => {
      m['sources'] = [{ type: 'rss', config: { urls: ['https://my.feed/rss'] } }];
      m['schedule'] = { cron: '0 9 * * *', timezone: 'Europe/Berlin' };
      m['model'] = { primary: 'deepseek-chat' };
      m['budget'] = { daily_usd_max: 1.5, tokens_per_run_max: 4000, halt_on_budget_exceeded: true };
      m['personalize'] = false;
      m['output'] = { format: 'newsletter_items', schema: './schema.json', min_items: 99 };
    });

    const res = await syncShippedAgents(bundled, user, logger);

    expect(res).toEqual([{ agent: 'newsletter-ai', from: '1.0', to: '2.0', template: 'newsletter-ai' }]);
    const m = manifestOf(user, 'newsletter-ai');
    expect(m.version).toBe('2.0');
    // the user's choices
    expect(m.sources).toEqual([{ type: 'rss', config: { urls: ['https://my.feed/rss'] } }]);
    expect(m.schedule).toEqual({ cron: '0 9 * * *', timezone: 'Europe/Berlin' });
    expect(m.model).toEqual({ primary: 'deepseek-chat' });
    expect(m.budget.daily_usd_max).toBe(1.5);
    expect(m.personalize).toBe(false);
    // what defines the agent comes from the shipped one again
    expect(m.output.min_items).toBe(5);
    // prompt and schema are the shipped ones; the frontmatter title is the user's
    const skill = matter(readFileSync(join(user, 'newsletter-ai', 'SKILL.md'), 'utf8'));
    expect(skill.content).toContain('story');
    expect(skill.content).not.toContain('OLD PROMPT BODY');
    expect(skill.data.title).toBe('Mein Titel');
    expect(readFileSync(join(user, 'newsletter-ai', 'schema.json'), 'utf8')).toContain('"story"');
    // and it still loads
    expect((await loadSkillDir(join(user, 'newsletter-ai'))).version).toBe('2.0');
  });

  it('backs up what it replaced', async () => {
    const user = tmp();
    oldCopy(user, 'newsletter-ai');
    await syncShippedAgents(shipped(), user, logger);
    const backup = join(user, 'newsletter-ai', '.backup-v1.0');
    expect(readFileSync(join(backup, 'SKILL.md'), 'utf8')).toContain('OLD PROMPT BODY');
    expect(readFileSync(join(backup, 'schema.json'), 'utf8')).toBe('{"old":true}');
    expect(parseYaml(readFileSync(join(backup, 'manifest.yaml'), 'utf8')).version).toBe('1.0');
  });

  it('does nothing when the versions match or the user has a newer one, and a second run changes nothing', async () => {
    const user = tmp();
    oldCopy(user, 'orchestrator');
    oldCopy(user, 'frag-die-zeitung', (m) => (m['version'] = '3.0'));
    const bundled = shipped('2.0');
    expect((await syncShippedAgents(bundled, user, logger)).map((r) => r.agent)).toEqual(['orchestrator']);
    expect(matter(readFileSync(join(user, 'frag-die-zeitung', 'SKILL.md'), 'utf8')).content).toContain('OLD PROMPT BODY');
    expect(await syncShippedAgents(bundled, user, logger)).toEqual([]);
  });

  it('updates the delegates of an old orchestrator (the project assistant appears)', async () => {
    const user = tmp();
    oldCopy(user, 'orchestrator', (m) => (m['delegates'] = ['frag-die-zeitung']));
    await syncShippedAgents(shipped(), user, logger);
    expect(manifestOf(user, 'orchestrator').delegates).toEqual(['frag-die-zeitung', 'projekt-assistent']);
  });

  it('drops a capability key the shipped agent no longer has', async () => {
    const user = tmp();
    oldCopy(user, 'orchestrator', (m) => (m['tools'] = ['fetch_full_text']));
    await syncShippedAgents(shipped(), user, logger);
    expect(manifestOf(user, 'orchestrator').tools).toBeUndefined();
  });

  it('gives a Ressort created from a template the new prompt with its own topic, and records the template', async () => {
    const user = tmp();
    const { dir } = await createAgent({
      input: { title: 'Fussball', focus: 'Fußball-Spiele, Bundesliga', sources: [{ type: 'rss', config: { urls: ['https://x.example/rss'] } }] },
      agentsDir: user,
      templateDir: join(REPO_AGENTS, 'newsletter-ai'),
    });
    // as a Ressort of an older release looked: old version, old prompt around the focus
    const mp = join(dir, 'manifest.yaml');
    const m = parseYaml(readFileSync(mp, 'utf8')) as Record<string, any>;
    m['version'] = '1.0';
    writeFileSync(mp, stringifyYaml(m));
    expect(m.template).toBe('newsletter-ai');

    const res = await syncShippedAgents(shipped(), user, logger);

    expect(res).toEqual([{ agent: 'fussball', from: '1.0', to: '2.0', template: 'newsletter-ai' }]);
    const body = matter(readFileSync(join(dir, 'SKILL.md'), 'utf8')).content;
    expect(body).toContain('matching this focus: "Fußball-Spiele, Bundesliga"');
    expect(body).toContain('story');
    expect(manifestOf(user, 'fussball')).toMatchObject({ id: 'fussball', topic: 'Fußball-Spiele, Bundesliga', template: 'newsletter-ai', version: '2.0' });
    expect(manifestOf(user, 'fussball').sources[0].config.urls).toEqual(['https://x.example/rss']);
    expect((await loadSkillDir(dir)).title).toBe('Fussball');
  });

  it('recognises a Ressort created before agents recorded their template, from its prompt', async () => {
    const user = tmp();
    const { dir } = await createAgent({
      input: { title: 'Alt', focus: 'Tennis', sources: [{ type: 'rss', config: { urls: ['https://x.example/rss'] } }] },
      agentsDir: user,
      templateDir: join(REPO_AGENTS, 'newsletter-ai'),
    });
    const mp = join(dir, 'manifest.yaml');
    const m = parseYaml(readFileSync(mp, 'utf8')) as Record<string, any>;
    delete m['template'];
    delete m['topic'];
    m['version'] = '1.0';
    writeFileSync(mp, stringifyYaml(m));

    expect((await syncShippedAgents(shipped(), user, logger)).map((r) => r.agent)).toEqual(['alt']);
    expect(manifestOf(user, 'alt')).toMatchObject({ topic: 'Tennis', template: 'newsletter-ai' });
  });

  it('leaves agents alone that are not copies of anything shipped, and survives a broken one', async () => {
    const user = tmp();
    mkdirSync(join(user, 'mine'));
    writeFileSync(join(user, 'mine', 'SKILL.md'), matter.stringify('my own prompt', { name: 'mine', description: 'd' }));
    writeFileSync(join(user, 'mine', 'manifest.yaml'), stringifyYaml({ id: 'mine', type: 'reactive', version: '1.0' }));
    mkdirSync(join(user, 'broken'));
    writeFileSync(join(user, 'broken', 'SKILL.md'), '---\n: : :\n---');
    writeFileSync(join(user, 'broken', 'manifest.yaml'), '{{{ not yaml');
    oldCopy(user, 'newsletter-ai');

    const res = await syncShippedAgents(shipped(), user, logger);

    expect(res.map((r) => r.agent)).toEqual(['newsletter-ai']);
    expect(readFileSync(join(user, 'mine', 'SKILL.md'), 'utf8')).toContain('my own prompt');
    expect(readdirSync(join(user, 'mine'))).toEqual(['SKILL.md', 'manifest.yaml']);
    expect(existsSync(join(user, 'broken', '.backup-v1.0'))).toBe(false);
  });
});
