/**
 * `fetch-gallery.ts` — the mobile API client for `GET /v1/gallery` (Content
 * Generation AC4). The single seam between the FastAPI gallery surface and the
 * mobile gallery tab.
 *
 * Responsibility:
 *   The server is the source of truth for a user's image history. It returns
 *   only **non-expired** generations, newest first. This module:
 *     1. defines the wire shape `api.schemas.gallery.GalleryListResponse` emits
 *        (snake_case 1:1);
 *     2. maps each entry to a camelCase {@link GalleryItem}; and
 *     3. provides a real `fetch`-backed transport factory the tab can wire.
 *
 * Image bytes are NOT in this payload — each item carries the `generationId`
 * the client turns into an authenticated image URL
 * (`${baseUrl}/v1/gallery/{generationId}/image`) via {@link galleryImageUrl},
 * fetched with the same Bearer token. There is no public/presigned URL.
 *
 * Mirrors `fetch-recipe-catalog.ts`: the pure `fetchGallery` mapper takes an
 * injected transport so the wire → camel projection is unit-testable without a
 * live HTTP client; `createGalleryTransport` is the thin real `fetch` factory.
 */
import { ApiError } from './api-error';
import { getApiBaseUrl } from './config/api-base-url';

// ---------------------------------------------------------------------------
// Wire shapes — snake_case 1:1 with the server's Pydantic models
// ---------------------------------------------------------------------------

/** A single gallery entry, 1:1 with `api.schemas.gallery.GalleryItemResponse`. */
export interface GalleryWireItem {
  readonly generation_id: string;
  readonly recipe_id: string;
  readonly created_at: string;
  readonly expires_at: string;
}

/** The body `GET /v1/gallery` returns, 1:1 with `GalleryListResponse`. */
export interface GalleryListWireResponse {
  readonly items: readonly GalleryWireItem[];
  readonly total: number;
}

// ---------------------------------------------------------------------------
// Client-facing camelCase projections
// ---------------------------------------------------------------------------

/** Client-facing camelCase projection of {@link GalleryWireItem}. */
export interface GalleryItem {
  readonly generationId: string;
  readonly recipeId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

/** Client-facing projection of the gallery list (server order: newest first). */
export interface GalleryList {
  readonly items: readonly GalleryItem[];
  readonly total: number;
}

// ---------------------------------------------------------------------------
// Pure wire → camel projection
// ---------------------------------------------------------------------------

/** Map a single snake_case wire entry to its camelCase projection. Pure. */
export function mapGalleryWireItem(wire: GalleryWireItem): GalleryItem {
  return {
    generationId: wire.generation_id,
    recipeId: wire.recipe_id,
    createdAt: wire.created_at,
    expiresAt: wire.expires_at,
  };
}

/** The injectable network seam: GET /v1/gallery → parsed wire body. */
export type GalleryTransport = () => Promise<GalleryListWireResponse>;

/**
 * Map the wire body from an injected transport to a {@link GalleryList}. The
 * transport owns the network + error surface; this owns only the pure
 * projection so the two concerns stay independently testable.
 */
export async function fetchGallery(transport: GalleryTransport): Promise<GalleryList> {
  const wire = await transport();
  return {
    items: wire.items.map(mapGalleryWireItem),
    total: wire.total,
  };
}

// ---------------------------------------------------------------------------
// Real transport factory + image-URL helper
// ---------------------------------------------------------------------------

/** Relative path of the gallery list endpoint under the `/v1` prefix. */
export const GALLERY_PATH = '/v1/gallery' as const;

/** Build the authenticated image URL for one generation. */
export function galleryImageUrl(generationId: string, baseUrl?: string): string {
  const origin = baseUrl ?? getApiBaseUrl();
  return `${origin}${GALLERY_PATH}/${generationId}/image`;
}

/** Minimal `fetch` contract this module relies on (testable without DOM). */
export type GalleryFetchLike = (
  input: string,
  init?: {
    readonly method?: string;
    readonly headers?: Readonly<Record<string, string>>;
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json: () => Promise<unknown>;
}>;

/** Configuration for {@link createGalleryTransport}. */
export interface GalleryTransportConfig {
  readonly accessToken: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: GalleryFetchLike;
}

/**
 * Build a real `fetch`-backed {@link GalleryTransport} for `GET /v1/gallery`.
 * Rejects on a non-2xx status so the caller can surface the failure without
 * crashing the tab.
 */
export function createGalleryTransport(
  config: GalleryTransportConfig,
): GalleryTransport {
  const baseUrl = config.baseUrl ?? getApiBaseUrl();
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;

  return async (): Promise<GalleryListWireResponse> => {
    const response = await fetchImpl(`${baseUrl}${GALLERY_PATH}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${config.accessToken}`,
      },
    });
    if (!response.ok) {
      throw new ApiError(
        response.status,
        `GET ${GALLERY_PATH} failed with status ${response.status}`,
      );
    }
    return (await response.json()) as GalleryListWireResponse;
  };
}
