// Built-in themes and the validator every theme file passes before use — the
// same check a later import of a user's theme file will run.

import Ajv2020, { type ErrorObject } from 'ajv/dist/2020';
import schema from './themes/samix-theme.schema.json';
import zeitung from './themes/zeitung.samix-theme.json';
import klar from './themes/klar.samix-theme.json';
import essay from './themes/essay.samix-theme.json';
import buch from './themes/buch.samix-theme.json';
import nacht from './themes/nacht.samix-theme.json';
import kontrast from './themes/kontrast.samix-theme.json';
import type { SamixTheme } from './types';

const validate = new Ajv2020({ allErrors: true }).compile<SamixTheme>(schema);

export class InvalidThemeError extends Error {
  constructor(
    readonly source: string,
    readonly errors: ErrorObject[]
  ) {
    super(`invalid theme ${source}: ${errors.map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ')}`);
  }
}

export function parseTheme(data: unknown, source: string): SamixTheme {
  if (!validate(data)) throw new InvalidThemeError(source, validate.errors ?? []);
  return data;
}

export const BUILT_IN_THEMES: SamixTheme[] = [zeitung, klar, essay, buch, nacht, kontrast].map((t) =>
  parseTheme(t, `${t.id}.samix-theme.json`)
);
