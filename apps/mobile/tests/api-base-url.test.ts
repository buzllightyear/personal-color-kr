/**
 * Unit test — `getApiBaseUrl()` (Phase 4.5 referrals/me wiring).
 *
 * Pins the env-var contract the referral share transport depends on:
 *   - reads `EXPO_PUBLIC_API_BASE_URL`;
 *   - strips a single trailing slash so callers append `/v1/...` cleanly;
 *   - degrades to '' when unset/blank (never throws — the share gate is soft).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { API_BASE_URL_ENV_KEY, getApiBaseUrl } from '../src/config/api-base-url';

describe('getApiBaseUrl', () => {
  const original = process.env[API_BASE_URL_ENV_KEY];

  beforeEach(() => {
    delete process.env[API_BASE_URL_ENV_KEY];
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env[API_BASE_URL_ENV_KEY];
    } else {
      process.env[API_BASE_URL_ENV_KEY] = original;
    }
  });

  it('returns the configured origin verbatim when set without a trailing slash', () => {
    process.env[API_BASE_URL_ENV_KEY] = 'https://api.example.com';
    expect(getApiBaseUrl()).toBe('https://api.example.com');
  });

  it('strips a single trailing slash so paths append cleanly', () => {
    process.env[API_BASE_URL_ENV_KEY] = 'https://api.example.com/';
    expect(getApiBaseUrl()).toBe('https://api.example.com');
  });

  it('returns an empty string when the env var is unset', () => {
    expect(getApiBaseUrl()).toBe('');
  });

  it('returns an empty string when the env var is blank', () => {
    process.env[API_BASE_URL_ENV_KEY] = '';
    expect(getApiBaseUrl()).toBe('');
  });
});
