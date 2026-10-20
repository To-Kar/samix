import type { ErrorObject } from 'ajv';

declare function validate(data: unknown): boolean;
declare namespace validate {
  let errors: ErrorObject[] | null | undefined;
}
export default validate;
