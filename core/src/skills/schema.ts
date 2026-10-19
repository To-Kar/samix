import { z } from 'zod';
import { MODEL_IDS, ROUTE_NAMES, SOURCE_TYPES } from '../types.js';
import { knownToolNames } from '../tools/index.js';

const modelIdSchema = z.enum(MODEL_IDS);

const modelPreferenceSchema = z.object({
  primary: modelIdSchema,
  fallback: modelIdSchema.optional(),
  routing: z.record(z.string(), modelIdSchema).optional(),
  timeout_secs: z.number().positive().optional(),
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
  type: z.enum(SOURCE_TYPES),
  config: z.record(z.string(), z.unknown()).default({}),
});

const outputSchema = z.object({
  format: z.string(),
  schema: z.string().optional(),
  min_items: z.number().int().min(0).optional(),
  max_items: z.number().int().min(0).optional(),
});

const routeSchema = z.enum(ROUTE_NAMES);

export const manifestYamlSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['reactive', 'proactive']),
  version: z.union([z.string(), z.number()]).transform((v) => String(v)),
  model: modelPreferenceSchema,
  budget: budgetSchema,
  schedule: scheduleSchema.optional(),
  sources: z.array(sourceSchema).optional(),
  output: outputSchema,
  dedupe_days: z.number().int().min(0).max(365).optional(),
  personalize: z.boolean().optional(),
  // Tools a reactive agent may call (names from tools/index.ts).
  tools: z
    .array(z.string())
    .optional()
    .refine((names) => (names ?? []).every((n) => knownToolNames().includes(n)), {
      message: `unknown tool; known: ${knownToolNames().join(', ')}`,
    }),
  routes: z.array(routeSchema).optional(),
  delegates: z.array(z.string().min(1)).optional(),
  empty_answer: z.string().min(1).max(300).optional(),
  // What a Ressort is about; sources that search by topic use it.
  topic: z.string().min(1).max(400).optional(),
});

export type ManifestYaml = z.infer<typeof manifestYamlSchema>;

export const skillFrontmatterSchema = z.object({
  name: z.string().min(1),
  title: z.string().min(1).optional(),
  description: z.string().min(1),
});
