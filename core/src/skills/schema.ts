import { z } from 'zod';

const modelIdSchema = z.enum([
  'static',
  'claude-haiku-4-5',
  'claude-sonnet-4-6',
  'gpt-4o-mini',
  'perplexity-sonar',
  'ollama-llama3',
]);

const modelPreferenceSchema = z.object({
  primary: modelIdSchema,
  fallback: modelIdSchema.optional(),
  routing: z.record(z.string(), modelIdSchema).optional(),
});

const budgetSchema = z.object({
  daily_usd_max: z.number().min(0),
  tokens_per_run_max: z.number().int().min(0),
  halt_on_budget_exceeded: z.boolean(),
});

const scheduleSchema = z.object({
  cron: z.string(),
  timezone: z.string(),
  jitter_seconds: z.number().int().min(0).optional(),
  catchup_on_startup: z.boolean().optional(),
});

const sourceSchema = z.object({
  type: z.enum(['rss', 'perplexity_search', 'arxiv', 'db_articles', 'url_fetch', 'api', 'custom']),
  config: z.record(z.string(), z.unknown()).default({}),
});

const outputSchema = z.object({
  format: z.string(),
  schema: z.string().optional(),
  min_items: z.number().int().min(0).optional(),
  max_items: z.number().int().min(0).optional(),
});

const contextSchema = z.object({
  inject_ambient: z.boolean().optional(),
}).optional();

export const manifestYamlSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['reactive', 'proactive']),
  version: z.union([z.string(), z.number()]).transform((v) => String(v)),
  model: modelPreferenceSchema,
  budget: budgetSchema,
  schedule: scheduleSchema.optional(),
  sources: z.array(sourceSchema).optional(),
  output: outputSchema,
  context: contextSchema,
  tools: z.array(z.string()).optional(),
});

export type ManifestYaml = z.infer<typeof manifestYamlSchema>;

export const skillFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
});
