import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/config/api-base-url.ts', import.meta.url),
  'utf-8',
);

describe('getApiBaseUrl env access is inlinable by Expo', () => {
  it('uses literal dot-notation process.env access (babel-preset-expo inlines only this form)', () => {
    expect(source).toContain('process.env.EXPO_PUBLIC_API_BASE_URL');
  });

  it('does not use bracket/computed env access (NOT inlined into the bundle)', () => {
    expect(source).not.toMatch(/process\.env\[/);
  });
});
