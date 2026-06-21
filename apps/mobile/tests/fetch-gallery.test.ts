/**
 * Unit test — `fetch-gallery.ts` (Content Generation AC4).
 *
 * Three surfaces:
 *   1. `fetchGallery(transport)` / `mapGalleryWireItem` — maps the snake_case
 *      wire body to the camelCase client projection. No I/O.
 *   2. `createGalleryTransport(config)` — the real `fetch`-backed transport:
 *      hits `${baseUrl}/v1/gallery`, attaches a Bearer token, rejects on
 *      non-2xx.
 *   3. `galleryImageUrl` — builds the authenticated per-image URL.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  createGalleryTransport,
  fetchGallery,
  GALLERY_PATH,
  galleryImageUrl,
  mapGalleryWireItem,
  type GalleryFetchLike,
  type GalleryListWireResponse,
  type GalleryWireItem,
} from '../src/fetch-gallery';

const WIRE_ITEM_1: GalleryWireItem = {
  generation_id: 'gen-001',
  recipe_id: 'summer-vibes',
  created_at: '2026-06-22T10:00:00Z',
  expires_at: '2026-07-22T10:00:00Z',
};

const WIRE_ITEM_2: GalleryWireItem = {
  generation_id: 'gen-002',
  recipe_id: 'winter-chic',
  created_at: '2026-06-21T09:00:00Z',
  expires_at: '2026-07-21T09:00:00Z',
};

const WIRE_LIST: GalleryListWireResponse = {
  items: [WIRE_ITEM_1, WIRE_ITEM_2],
  total: 2,
};

function okResponse(body: unknown): ReturnType<GalleryFetchLike> {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
}

describe('mapGalleryWireItem', () => {
  it('projects every snake_case field to camelCase', () => {
    expect(mapGalleryWireItem(WIRE_ITEM_1)).toEqual({
      generationId: 'gen-001',
      recipeId: 'summer-vibes',
      createdAt: '2026-06-22T10:00:00Z',
      expiresAt: '2026-07-22T10:00:00Z',
    });
  });
});

describe('fetchGallery', () => {
  it('maps the wire list preserving server order + total', async () => {
    const result = await fetchGallery(() => Promise.resolve(WIRE_LIST));
    expect(result.total).toBe(2);
    expect(result.items.map((i) => i.generationId)).toEqual(['gen-001', 'gen-002']);
  });

  it('handles an empty gallery', async () => {
    const result = await fetchGallery(() => Promise.resolve({ items: [], total: 0 }));
    expect(result).toEqual({ items: [], total: 0 });
  });
});

describe('createGalleryTransport', () => {
  it('GETs the gallery path with a Bearer token', async () => {
    const fetchImpl = vi.fn<Parameters<GalleryFetchLike>, ReturnType<GalleryFetchLike>>(
      () => okResponse(WIRE_LIST),
    );
    const transport = createGalleryTransport({
      accessToken: 'tok-123',
      baseUrl: 'https://api.example.com',
      fetchImpl,
    });
    const body = await transport();
    expect(body).toEqual(WIRE_LIST);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`https://api.example.com${GALLERY_PATH}`);
    expect(init?.method).toBe('GET');
    expect(init?.headers?.Authorization).toBe('Bearer tok-123');
  });

  it('rejects on a non-2xx status', async () => {
    const fetchImpl = vi.fn<Parameters<GalleryFetchLike>, ReturnType<GalleryFetchLike>>(
      () =>
        Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) }),
    );
    const transport = createGalleryTransport({
      accessToken: '',
      baseUrl: 'https://api.example.com',
      fetchImpl,
    });
    await expect(transport()).rejects.toThrow(/status 401/);
  });
});

describe('galleryImageUrl', () => {
  it('builds the per-generation image URL', () => {
    expect(galleryImageUrl('gen-001', 'https://api.example.com')).toBe(
      'https://api.example.com/v1/gallery/gen-001/image',
    );
  });
});
