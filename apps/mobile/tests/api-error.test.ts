/**
 * Unit test — `ApiError` + `isUnauthorized` (the auth self-heal predicate).
 */
import { describe, expect, it } from 'vitest';

import { ApiError, isUnauthorized } from '../src/api-error';

describe('ApiError', () => {
  it('is an Error carrying the numeric status + a default message containing it', () => {
    const e = new ApiError(401);
    expect(e).toBeInstanceOf(Error);
    expect(e.status).toBe(401);
    expect(e.name).toBe('ApiError');
    expect(e.message).toContain('401');
  });

  it('preserves a custom message (so transport status text survives)', () => {
    const e = new ApiError(403, 'GET /v1/recipes failed with status 403');
    expect(e.message).toBe('GET /v1/recipes failed with status 403');
    expect(e.status).toBe(403);
  });
});

describe('isUnauthorized', () => {
  it('true for an ApiError with status 401', () => {
    expect(isUnauthorized(new ApiError(401))).toBe(true);
  });

  it('false for an ApiError with any non-401 status', () => {
    expect(isUnauthorized(new ApiError(403))).toBe(false);
    expect(isUnauthorized(new ApiError(404))).toBe(false);
    expect(isUnauthorized(new ApiError(500))).toBe(false);
  });

  it("true for a kind:'unauthorized' error (GenerationRequestError shape, duck-typed)", () => {
    expect(isUnauthorized({ kind: 'unauthorized' })).toBe(true);
  });

  it('false for other discriminated kinds, plain errors, and non-objects', () => {
    expect(isUnauthorized({ kind: 'network' })).toBe(false);
    expect(isUnauthorized({ kind: 'recipe_not_found' })).toBe(false);
    expect(isUnauthorized(new Error('boom'))).toBe(false);
    expect(isUnauthorized(null)).toBe(false);
    expect(isUnauthorized(undefined)).toBe(false);
    expect(isUnauthorized('401')).toBe(false);
  });
});
