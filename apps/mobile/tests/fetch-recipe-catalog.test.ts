/**
 * Unit test — `fetch-recipe-catalog.ts` (Content Generation Phase).
 *
 * Three surfaces:
 *   1. `fetchRecipeCatalog(transport)` / `mapCatalogRecipeWireItem` — maps the
 *      snake_case wire body to the camelCase client projections (recipe list +
 *      individual items). No I/O — the network call is delegated to the
 *      injected transport.
 *   2. `createRecipeCatalogTransport(config)` — the real `fetch`-backed
 *      transport: hits `${baseUrl}/v1/recipes`, attaches a Bearer token, and
 *      rejects on non-2xx so the catalog tab can handle auth/network failures.
 *   3. camelCase field projection — verifies every snake_case wire field maps
 *      to the correct camelCase key without a live HTTP client.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  createRecipeCatalogTransport,
  fetchRecipeCatalog,
  mapCatalogRecipeWireItem,
  RECIPE_CATALOG_PATH,
  type CatalogRecipeListWireResponse,
  type CatalogRecipeWireItem,
  type RecipeCatalogFetchLike,
} from '../src/fetch-recipe-catalog';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WIRE_ITEM_1: CatalogRecipeWireItem = {
  recipe_id: 'summer-vibes-2024',
  style_reference_key: 'styles/summer-vibes.jpg',
  publish_date: '2024-06-01T00:00:00Z',
  display_order: 1,
  created_at: '2024-05-20T10:00:00Z',
  title: 'Summer Vibes',
  description: 'Bright summer look',
  tags: ['summer', 'HOT'],
  thumbnail_url: 'https://cdn.example.com/summer.png',
};

const WIRE_ITEM_2: CatalogRecipeWireItem = {
  recipe_id: 'winter-chic-2024',
  style_reference_key: null,
  publish_date: '2024-12-01T00:00:00Z',
  display_order: 2,
  created_at: '2024-11-15T08:30:00Z',
  title: 'Winter Chic',
  description: null,
  tags: [],
  thumbnail_url: null,
};

const WIRE_LIST: CatalogRecipeListWireResponse = {
  recipes: [WIRE_ITEM_1, WIRE_ITEM_2],
  total: 2,
};

function okResponse(body: unknown): ReturnType<RecipeCatalogFetchLike> {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
}

// ---------------------------------------------------------------------------
// mapCatalogRecipeWireItem — pure projection
// ---------------------------------------------------------------------------

describe('mapCatalogRecipeWireItem — wire → camel projection', () => {
  it('maps every snake_case field to camelCase', () => {
    const result = mapCatalogRecipeWireItem(WIRE_ITEM_1);
    expect(result).toEqual({
      recipeId: 'summer-vibes-2024',
      styleReferenceKey: 'styles/summer-vibes.jpg',
      publishDate: '2024-06-01T00:00:00Z',
      displayOrder: 1,
      createdAt: '2024-05-20T10:00:00Z',
      title: 'Summer Vibes',
      description: 'Bright summer look',
      tags: ['summer', 'HOT'],
      thumbnailUrl: 'https://cdn.example.com/summer.png',
    });
  });

  it('preserves null description and thumbnailUrl, and empty tags', () => {
    const result = mapCatalogRecipeWireItem(WIRE_ITEM_2);
    expect(result.description).toBeNull();
    expect(result.thumbnailUrl).toBeNull();
    expect(result.tags).toEqual([]);
  });

  it('preserves null styleReferenceKey (no style image configured)', () => {
    const result = mapCatalogRecipeWireItem(WIRE_ITEM_2);
    expect(result.styleReferenceKey).toBeNull();
  });

  it('preserves null publishDate when the server sends null', () => {
    const itemWithNullDate: CatalogRecipeWireItem = {
      ...WIRE_ITEM_1,
      publish_date: null,
    };
    const result = mapCatalogRecipeWireItem(itemWithNullDate);
    expect(result.publishDate).toBeNull();
  });

  it('carries displayOrder and createdAt through unchanged', () => {
    const result = mapCatalogRecipeWireItem(WIRE_ITEM_1);
    expect(result.displayOrder).toBe(1);
    expect(result.createdAt).toBe('2024-05-20T10:00:00Z');
  });

  it('result has no snake_case keys', () => {
    const result = mapCatalogRecipeWireItem(WIRE_ITEM_1) as unknown as Record<
      string,
      unknown
    >;
    expect(Object.keys(result)).not.toContain('recipe_id');
    expect(Object.keys(result)).not.toContain('style_reference_key');
    expect(Object.keys(result)).not.toContain('publish_date');
    expect(Object.keys(result)).not.toContain('display_order');
    expect(Object.keys(result)).not.toContain('created_at');
    expect(Object.keys(result)).not.toContain('thumbnail_url');
  });
});

// ---------------------------------------------------------------------------
// fetchRecipeCatalog — transport delegation + list projection
// ---------------------------------------------------------------------------

describe('fetchRecipeCatalog — wire → camel list projection', () => {
  it('maps a multi-item list to camelCase projections', async () => {
    const result = await fetchRecipeCatalog(() => Promise.resolve(WIRE_LIST));
    expect(result.total).toBe(2);
    expect(result.recipes).toHaveLength(2);
    expect(result.recipes[0]).toEqual({
      recipeId: 'summer-vibes-2024',
      styleReferenceKey: 'styles/summer-vibes.jpg',
      publishDate: '2024-06-01T00:00:00Z',
      displayOrder: 1,
      createdAt: '2024-05-20T10:00:00Z',
      title: 'Summer Vibes',
      description: 'Bright summer look',
      tags: ['summer', 'HOT'],
      thumbnailUrl: 'https://cdn.example.com/summer.png',
    });
    expect(result.recipes[1]).toEqual({
      recipeId: 'winter-chic-2024',
      styleReferenceKey: null,
      publishDate: '2024-12-01T00:00:00Z',
      displayOrder: 2,
      createdAt: '2024-11-15T08:30:00Z',
      title: 'Winter Chic',
      description: null,
      tags: [],
      thumbnailUrl: null,
    });
  });

  it('handles an empty catalog list', async () => {
    const emptyWire: CatalogRecipeListWireResponse = { recipes: [], total: 0 };
    const result = await fetchRecipeCatalog(() => Promise.resolve(emptyWire));
    expect(result.recipes).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('preserves server sort order (transport order is authoritative)', async () => {
    const result = await fetchRecipeCatalog(() => Promise.resolve(WIRE_LIST));
    expect(result.recipes[0]?.recipeId).toBe('summer-vibes-2024');
    expect(result.recipes[1]?.recipeId).toBe('winter-chic-2024');
  });

  it('propagates a transport rejection to the caller', async () => {
    await expect(
      fetchRecipeCatalog(() => Promise.reject(new Error('network error'))),
    ).rejects.toThrow('network error');
  });

  it('propagates any transport error without wrapping it', async () => {
    const originalError = new TypeError('fetch is not a function');
    await expect(fetchRecipeCatalog(() => Promise.reject(originalError))).rejects.toBe(
      originalError,
    );
  });
});

// ---------------------------------------------------------------------------
// createRecipeCatalogTransport — real fetch wiring
// ---------------------------------------------------------------------------

describe('createRecipeCatalogTransport — real fetch wiring', () => {
  it('GETs the recipe catalog path against the configured base URL', async () => {
    const fetchImpl = vi.fn<
      Parameters<RecipeCatalogFetchLike>,
      ReturnType<RecipeCatalogFetchLike>
    >(() => okResponse(WIRE_LIST));

    const transport = createRecipeCatalogTransport({
      accessToken: 'jwt-token',
      baseUrl: 'https://api.example.com',
      fetchImpl,
    });
    const body = await transport();

    expect(body).toEqual(WIRE_LIST);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call!;
    expect(url).toBe(`https://api.example.com${RECIPE_CATALOG_PATH}`);
    expect(init?.method).toBe('GET');
  });

  it('forwards the Bearer Authorization header', async () => {
    const fetchImpl = vi.fn<
      Parameters<RecipeCatalogFetchLike>,
      ReturnType<RecipeCatalogFetchLike>
    >(() => okResponse(WIRE_LIST));

    const transport = createRecipeCatalogTransport({
      accessToken: 'my-jwt-token',
      baseUrl: 'https://api.example.com',
      fetchImpl,
    });
    await transport();

    const call = fetchImpl.mock.calls[0];
    expect(call).toBeDefined();
    const [, init] = call!;
    expect(init?.headers?.Authorization).toBe('Bearer my-jwt-token');
  });

  it('includes Accept: application/json header', async () => {
    const fetchImpl = vi.fn<
      Parameters<RecipeCatalogFetchLike>,
      ReturnType<RecipeCatalogFetchLike>
    >(() => okResponse(WIRE_LIST));

    const transport = createRecipeCatalogTransport({
      accessToken: 'jwt-token',
      baseUrl: 'https://api.example.com',
      fetchImpl,
    });
    await transport();

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init?.headers?.Accept).toBe('application/json');
  });

  it('rejects with an error message containing the status on non-2xx', async () => {
    const fetchImpl: RecipeCatalogFetchLike = () =>
      Promise.resolve({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ detail: 'invalid_authorization' }),
      });

    const transport = createRecipeCatalogTransport({
      accessToken: 'expired-token',
      baseUrl: 'https://api.example.com',
      fetchImpl,
    });
    await expect(transport()).rejects.toThrow('401');
  });

  it('rejects on 403 (user_not_found)', async () => {
    const fetchImpl: RecipeCatalogFetchLike = () =>
      Promise.resolve({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ detail: 'user_not_found' }),
      });

    const transport = createRecipeCatalogTransport({
      accessToken: 'valid-token',
      baseUrl: 'https://api.example.com',
      fetchImpl,
    });
    await expect(transport()).rejects.toThrow('403');
  });

  it('rejects on 500 (server error)', async () => {
    const fetchImpl: RecipeCatalogFetchLike = () =>
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ detail: 'internal_error' }),
      });

    const transport = createRecipeCatalogTransport({
      accessToken: 'jwt-token',
      baseUrl: 'https://api.example.com',
      fetchImpl,
    });
    await expect(transport()).rejects.toThrow('500');
  });

  it('propagates a network-level fetch rejection', async () => {
    const fetchImpl: RecipeCatalogFetchLike = () =>
      Promise.reject(new Error('Network request failed'));

    const transport = createRecipeCatalogTransport({
      accessToken: 'jwt-token',
      baseUrl: 'https://api.example.com',
      fetchImpl,
    });
    await expect(transport()).rejects.toThrow('Network request failed');
  });

  it('uses RECIPE_CATALOG_PATH constant in the constructed URL', async () => {
    const fetchImpl = vi.fn<
      Parameters<RecipeCatalogFetchLike>,
      ReturnType<RecipeCatalogFetchLike>
    >(() => okResponse(WIRE_LIST));

    const transport = createRecipeCatalogTransport({
      accessToken: 'jwt-token',
      baseUrl: 'https://api.example.com',
      fetchImpl,
    });
    await transport();

    const [url] = fetchImpl.mock.calls[0]!;
    expect(url).toContain(RECIPE_CATALOG_PATH);
    expect(RECIPE_CATALOG_PATH).toBe('/v1/recipes');
  });
});

// ---------------------------------------------------------------------------
// camelCase field projection — end-to-end round-trip
// ---------------------------------------------------------------------------

describe('camelCase field projection — full round-trip via fetchRecipeCatalog', () => {
  it('result has no snake_case keys at any level', async () => {
    const result = await fetchRecipeCatalog(() => Promise.resolve(WIRE_LIST));
    for (const recipe of result.recipes) {
      const keys = Object.keys(recipe);
      expect(keys).not.toContain('recipe_id');
      expect(keys).not.toContain('style_reference_key');
      expect(keys).not.toContain('publish_date');
      expect(keys).not.toContain('display_order');
      expect(keys).not.toContain('created_at');
      expect(keys).not.toContain('thumbnail_url');
      // Confirm camelCase keys are present
      expect(keys).toContain('recipeId');
      expect(keys).toContain('styleReferenceKey');
      expect(keys).toContain('publishDate');
      expect(keys).toContain('displayOrder');
      expect(keys).toContain('createdAt');
      expect(keys).toContain('title');
      expect(keys).toContain('description');
      expect(keys).toContain('tags');
      expect(keys).toContain('thumbnailUrl');
    }
  });

  it('round-trips total count unchanged', async () => {
    const wire: CatalogRecipeListWireResponse = {
      recipes: [WIRE_ITEM_1],
      total: 42,
    };
    const result = await fetchRecipeCatalog(() => Promise.resolve(wire));
    expect(result.total).toBe(42);
  });
});
