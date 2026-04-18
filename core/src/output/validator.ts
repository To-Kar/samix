import Ajv2020, { type ValidateFunction, type ErrorObject } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFile } from 'node:fs/promises';
import type { OutputValidator, ValidationResult } from '../types.js';

// Instantiate once per process and reuse; the compiled-schema cache is the
// hot path and must persist across runs for the same skill.
// `strict: false` — skill schemas target Draft 2020-12 and may use newer
// keywords; strict mode would reject unknowns and break forward compat.
export class JsonSchemaValidator implements OutputValidator {
  private readonly ajv: Ajv2020;
  private readonly cache = new Map<string, ValidateFunction>();

  constructor() {
    this.ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(this.ajv);
  }

  async validate(raw: unknown, schemaPath: string): Promise<ValidationResult> {
    let parsed: unknown;
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        return {
          valid: false,
          errors: [`invalid_json: ${err instanceof Error ? err.message : String(err)}`],
        };
      }
    } else {
      parsed = raw;
    }

    let validator: ValidateFunction;
    try {
      validator = await this.getCompiled(schemaPath);
    } catch (err) {
      return {
        valid: false,
        errors: [`schema_load_failed: ${err instanceof Error ? err.message : String(err)}`],
        parsed,
      };
    }

    const ok = validator(parsed);
    if (ok) {
      return { valid: true, parsed };
    }
    return {
      valid: false,
      errors: (validator.errors ?? []).map(formatError),
      // Include parsed even on failure so the runner can persist the raw
      // output on AgentRun.output and the user can diagnose.
      parsed,
    };
  }

  private async getCompiled(schemaPath: string): Promise<ValidateFunction> {
    const cached = this.cache.get(schemaPath);
    if (cached) return cached;
    const raw = await readFile(schemaPath, 'utf8');
    const schema = JSON.parse(raw);
    const validator = this.ajv.compile(schema);
    this.cache.set(schemaPath, validator);
    return validator;
  }
}

function formatError(e: ErrorObject): string {
  return `${e.instancePath || '/'} ${e.message ?? 'invalid'}`.trim();
}
