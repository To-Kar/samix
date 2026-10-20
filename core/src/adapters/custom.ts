import { OpenAICompatAdapter } from './openai-compat.js';
import { getCustomModel, getPriceOverride, isAdvanced } from '../settings.js';

export const CUSTOM_KEY_ENV = 'CUSTOM_API_KEY';

/**
 * The reader's own model. Refuses to exist without advanced mode, a configured
 * endpoint and a price: a model without a price would make the cost figures lie.
 */
export function createCustomAdapter(): OpenAICompatAdapter {
  if (!isAdvanced()) throw new Error('The custom model needs the advanced AI mode (Einrichtung → Modell).');
  const c = getCustomModel();
  if (!c) throw new Error('The custom model is not configured (Einrichtung → Modell → Eigenes Modell).');
  const price = getPriceOverride('custom');
  if (!price) throw new Error('The custom model has no price set; enter the price per million tokens first.');
  return new OpenAICompatAdapter({
    name: 'custom',
    label: 'Custom model',
    baseUrl: c.baseUrl,
    model: c.model,
    pricing: price,
    supportsTools: c.tools,
    keyEnv: CUSTOM_KEY_ENV,
    keyRequired: false,
  });
}
