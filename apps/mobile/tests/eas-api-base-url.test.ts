import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface EasBuildProfile {
  readonly env?: { readonly EXPO_PUBLIC_API_BASE_URL?: string };
}
interface EasConfig {
  readonly build: Record<string, EasBuildProfile>;
}

const easConfig = JSON.parse(
  readFileSync(new URL('../eas.json', import.meta.url), 'utf-8'),
) as EasConfig;

const apiBaseUrls: readonly string[] = Object.values(easConfig.build)
  .map((profile) => profile.env?.EXPO_PUBLIC_API_BASE_URL)
  .filter((url): url is string => typeof url === 'string');

describe('eas.json EXPO_PUBLIC_API_BASE_URL', () => {
  it('no longer points at the suspended Fly backend', () => {
    expect(apiBaseUrls.length).toBeGreaterThan(0);
    for (const url of apiBaseUrls) {
      expect(url).not.toContain('fly.dev');
    }
  });

  it('points every build profile at the same Render https URL', () => {
    for (const url of apiBaseUrls) {
      expect(url).toMatch(/^https:\/\/[a-z0-9-]+\.onrender\.com$/);
    }
    expect(new Set(apiBaseUrls).size).toBe(1);
  });
});
