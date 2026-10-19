import { describe, expect, it } from 'vitest';
import { folderName } from './native';

describe('folderName', () => {
  it('takes the last segment of a macOS or Windows path, with or without a trailing separator', () => {
    expect(folderName('/Users/me/Projekte/Mein Projekt')).toBe('Mein Projekt');
    expect(folderName('/Users/me/Projekte/Mein Projekt/')).toBe('Mein Projekt');
    expect(folderName('C:\\Users\\me\\Code\\samix\\')).toBe('samix');
    expect(folderName('/')).toBe('');
  });
});
