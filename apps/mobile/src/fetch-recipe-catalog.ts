/**
 * `fetch-recipe-catalog.ts` — the mobile API client for `GET /v1/recipes`
 * (Content Generation Phase). This is the single seam between the FastAPI
 * public recipe catalog surface and the mobile recipe-catalog tab.
 *
 * Responsibility:
 *   The server is the *single source of truth* for the curated recipe
 *   catalog. Only **published** recipes are returned, sorted by
 *   `publish_date DESC, display_order ASC`. This module:
 *     1. defines the wire shape the FastAPI `CatalogRecipeResponse` /
 *        `CatalogRecipeListResponse` emit (snake_case 1:1 with
 *        `api.schemas.recipes.CatalogRecipeResponse`);
 *     2. maps each entry to a client-facing camelCase value object; and
 *     3. provides a real `fetch`-backed transport factory so the tab can
 *        wire an actual `GET ${baseUrl}/v1/recipes` against the backend.
 *
 * Why dependency injection (transport seam):
 *   Mirrors the sibling `fetch-referral-me.ts` / `request-diagnosis.ts`
 *   stance: the pure mapping (`fetchRecipeCatalog`) takes an injected
 *   transport so the wire → camel projection is unit-testable without a
 *   live HTTP client, expo modules, or a running backend. The real
 *   transport (`createRecipeCatalogTransport`) is a thin factory over
 *   global `fetch`, itself testable via an injected `fetchImpl`.
 *
 * Auth (Bearer) is REQUIRED:
 *   `GET /v1/recipes` rejects an unauthenticated request with HTTP 401.
 *   The access token is injected (not read from a store) so this module
 *   stays decoupled from the auth-session wiring.
 *
 * Public-surface discipline:
 *   Internal generation details (`model_id`, `prompt_template`,
 *   `parameters`) are NOT present in the wire response — the server omits
 *   them intentionally. The mobile client never receives or handles those
 *   fields; only the fields needed for catalog display and recipe
 *   selection are projected here.
 */
import { getApiBaseUrl } from './config/api-base-url';

// ---------------------------------------------------------------------------
// Wire shapes — snake_case 1:1 with the server's Pydantic models
// ---------------------------------------------------------------------------

/**
 * A single catalog entry as returned by the server, snake_case 1:1 with
 * `api.schemas.recipes.CatalogRecipeResponse`. This is the wire contract —
 * keep field names in lock-step with that schema.
 *
 * Note: `publish_date` and `created_at` arrive as ISO 8601 strings over the
 * wire (FastAPI serialises `datetime` to ISO format by default).
 */
export interface CatalogRecipeWireItem {
  readonly recipe_id: string;
  readonly style_reference_key: string | null;
  readonly publish_date: string | null;
  readonly display_order: number;
  readonly created_at: string;
  readonly title: string;
  readonly description: string | null;
  readonly tags: readonly string[];
  readonly thumbnail_url: string | null;
}

/**
 * The JSON body `GET /v1/recipes` returns, 1:1 with
 * `api.schemas.recipes.CatalogRecipeListResponse`. Carries the typed list
 * plus a `total` count that the client can use for empty-state detection.
 */
export interface CatalogRecipeListWireResponse {
  readonly recipes: readonly CatalogRecipeWireItem[];
  readonly total: number;
}

// ---------------------------------------------------------------------------
// Client-facing camelCase projections
// ---------------------------------------------------------------------------

/**
 * Client-facing camelCase projection of {@link CatalogRecipeWireItem}.
 *
 * `recipeId` is the human-readable unique identifier (used for recipe
 * selection and navigation). `styleReferenceKey` is the object-storage key
 * for the style reference image (may be absent). `publishDate` / `createdAt`
 * are ISO 8601 strings. `displayOrder` is the operator-set sort weight within
 * the same publish-date bucket.
 */
export interface CatalogRecipe {
  readonly recipeId: string;
  readonly styleReferenceKey: string | null;
  readonly publishDate: string | null;
  readonly displayOrder: number;
  readonly createdAt: string;
  readonly title: string;
  readonly description: string | null;
  readonly tags: readonly string[];
  readonly thumbnailUrl: string | null;
}

/**
 * Client-facing projection of the catalog list response.
 *
 * `recipes` is in server sort order (`publishDate DESC, displayOrder ASC`).
 * `total` matches `recipes.length` for Phase 1 (no server-side pagination).
 */
export interface CatalogRecipeList {
  readonly recipes: readonly CatalogRecipe[];
  readonly total: number;
}

// ---------------------------------------------------------------------------
// Pure wire → camel projection
// ---------------------------------------------------------------------------

/**
 * Map a single snake_case wire entry to its camelCase client projection.
 * Pure — no I/O.
 */
export function mapCatalogRecipeWireItem(wire: CatalogRecipeWireItem): CatalogRecipe {
  return {
    recipeId: wire.recipe_id,
    styleReferenceKey: wire.style_reference_key,
    publishDate: wire.publish_date,
    displayOrder: wire.display_order,
    createdAt: wire.created_at,
    title: wire.title,
    description: wire.description,
    tags: wire.tags,
    thumbnailUrl: wire.thumbnail_url,
  };
}

/**
 * The injectable network seam: perform the authenticated
 * `GET /v1/recipes` and resolve to its parsed wire body. Injected so the
 * `fetchRecipeCatalog` mapper is testable without a real HTTP client, and so
 * the route can wire a real `fetch` at the call site.
 */
export type RecipeCatalogTransport = () => Promise<CatalogRecipeListWireResponse>;

/**
 * Map the wire body returned by an injected transport to a
 * {@link CatalogRecipeList}. The transport owns the network + error surface;
 * this function owns only the pure projection so the two concerns stay
 * independently testable.
 *
 * @param transport - injectable seam performing the actual GET.
 * @returns camelCase catalog list in server sort order.
 */
export async function fetchRecipeCatalog(
  transport: RecipeCatalogTransport,
): Promise<CatalogRecipeList> {
  const wire = await transport();
  return {
    recipes: wire.recipes.map(mapCatalogRecipeWireItem),
    total: wire.total,
  };
}

// ---------------------------------------------------------------------------
// Real transport factory
// ---------------------------------------------------------------------------

/** The relative path of the public recipe catalog endpoint under the `/v1` prefix. */
export const RECIPE_CATALOG_PATH = '/v1/recipes' as const;

/**
 * The minimal slice of the WHATWG `fetch` contract this module relies on,
 * declared locally so the factory is testable with a tiny stub (and does not
 * couple the test to RN's global `fetch` typing).
 */
export type RecipeCatalogFetchLike = (
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

/**
 * Configuration for {@link createRecipeCatalogTransport}.
 *
 * `accessToken` is the REQUIRED backend JWT forwarded as a `Bearer` header;
 * `baseUrl` defaults to {@link getApiBaseUrl}; `fetchImpl` defaults to the
 * runtime global `fetch` and is overridable in tests.
 */
export interface RecipeCatalogTransportConfig {
  readonly accessToken: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: RecipeCatalogFetchLike;
}

/**
 * Build a real `fetch`-backed {@link RecipeCatalogTransport} for
 * `GET /v1/recipes`.
 *
 * The returned transport issues the GET against
 * `${baseUrl}${RECIPE_CATALOG_PATH}`, attaching
 * `Authorization: Bearer <token>`, and rejects on a non-2xx status so the
 * caller can surface the failure without crashing the tab.
 *
 * @param config - access token / base URL / fetch override.
 * @returns a transport suitable for {@link fetchRecipeCatalog}.
 */
export function createRecipeCatalogTransport(
  config: RecipeCatalogTransportConfig,
): RecipeCatalogTransport {
  const baseUrl = config.baseUrl ?? getApiBaseUrl();
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;

  return async (): Promise<CatalogRecipeListWireResponse> => {
    const response = await fetchImpl(`${baseUrl}${RECIPE_CATALOG_PATH}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${config.accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(
        `GET ${RECIPE_CATALOG_PATH} failed with status ${response.status}`,
      );
    }

    return (await response.json()) as CatalogRecipeListWireResponse;
  };
}
