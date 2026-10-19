// UI strings, one module per area under ./ns. In each module `de` defines
// the keys and `en` is typed against it, so a missing or extra translation
// fails `tsc`. Parameterised strings are functions.

import * as agents from './ns/agents';
import * as app from './ns/app';
import * as appearance from './ns/appearance';
import * as ask from './ns/ask';
import * as costs from './ns/costs';
import * as data from './ns/data';
import * as explain from './ns/explain';
import * as model from './ns/model';
import * as onboarding from './ns/onboarding';
import * as paper from './ns/paper';
import * as reader from './ns/reader';
import * as schedule from './ns/schedule';
import * as settings from './ns/settings';
import * as sources from './ns/sources';

const de = { ...app.de, ...appearance.de, ...explain.de, ...paper.de, ...reader.de, ...ask.de, ...settings.de, ...agents.de, ...schedule.de, ...costs.de, ...onboarding.de, ...sources.de, ...data.de, ...model.de };
const en: Messages = { ...app.en, ...appearance.en, ...explain.en, ...paper.en, ...reader.en, ...ask.en, ...settings.en, ...agents.en, ...schedule.en, ...costs.en, ...onboarding.en, ...sources.en, ...data.en, ...model.en };

export type Messages = typeof de;

export const LOCALES = ['de', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const MESSAGES: Record<Locale, Messages> = { de, en };

/** BCP 47 tag used for dates, times and numbers. */
export const DATE_LOCALE: Record<Locale, string> = { de: 'de-DE', en: 'en-GB' };

/** Names shown in the language picker, each in its own language. */
export const LOCALE_NAMES: Record<Locale, string> = { de: 'Deutsch', en: 'English' };
