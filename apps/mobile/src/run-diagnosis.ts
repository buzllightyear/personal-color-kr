/**
 * `run-diagnosis.ts` — orchestration glue that fires the real
 * `POST /v1/diagnose` round-trip and drives the funnel `diagnosis` slice
 * through its `pending → success | error` lifecycle.
 *
 * Where this runs:
 *   The step-8 `fake_scan_animation` route kicks this off on mount so the
 *   network latency is masked by the 5-second scan overlay. By the time the
 *   user lands on step 9 (`result_reveal`) the slice typically holds the
 *   diagnosed result; if the call is slower the screen renders the static
 *   teaser fallback and re-renders when the result arrives.
 *
 * Graceful degradation (the pre-membership reality):
 *   The real call needs (a) a genuine `file://` selfie from the device picker
 *   and (b) a backend JWT (Apple-Sign-In-gated). Until both exist, the route
 *   resolves a `null` selfie / token via {@link selfieFileFromUri} /
 *   `getDevAuthToken` and simply does not invoke this function — the slice
 *   stays `idle` and `result_reveal` shows the existing fake teaser. This
 *   module therefore assumes a non-null selfie + token and owns only the
 *   "fire it and record the outcome" sequencing.
 *
 * Why dependency-injected:
 *   `requestImpl` defaults to the real `createDiagnosisTransport` +
 *   `requestDiagnosis` pipeline but is injectable so the lifecycle transitions
 *   (pending → success / pending → error-with-kind) are unit-testable without
 *   a live HTTP client or `FormData`.
 */
import {
  createDiagnosisTransport,
  DiagnosisRequestError,
  requestDiagnosis,
  type DiagnosisErrorKind,
  type DiagnosisResult,
  type SelfieFile,
} from './request-diagnosis';
import type { SetDiagnosis } from './contracts/funnel-state';

/**
 * Derive an uploadable {@link SelfieFile} from a funnel `selfieUri`.
 *
 * Returns `null` — signalling "do not fire the real call" — when the URI is
 * absent or is NOT a real device file (`file://`). The Phase 2.3 capture
 * surface mints `stub://selfie/<timestamp>` placeholders; those cannot be
 * uploaded, so a stub URI degrades to the static teaser rather than a
 * guaranteed-failing request. The real device picker (a sibling increment)
 * produces `file://` URIs that pass this guard.
 *
 * The MIME type is inferred from the extension (`.png` → `image/png`, else
 * `image/jpeg`); the picker increment can supply richer metadata later without
 * changing this contract.
 */
export function selfieFileFromUri(uri: string | null): SelfieFile | null {
  if (uri === null || !uri.startsWith('file://')) {
    return null;
  }
  const isPng = uri.toLowerCase().endsWith('.png');
  return {
    uri,
    name: isPng ? 'selfie.png' : 'selfie.jpg',
    mimeType: isPng ? 'image/png' : 'image/jpeg',
  };
}

/**
 * The injectable diagnosis call. Defaults to the real transport pipeline;
 * tests inject a resolved/rejected stub to drive the success / error branches.
 */
export type DiagnosisRequestImpl = (
  selfie: SelfieFile,
  accessToken: string,
  baseUrl?: string,
) => Promise<DiagnosisResult>;

/** Parameters for {@link runDiagnosis}. */
export interface RunDiagnosisParams {
  readonly selfie: SelfieFile;
  readonly accessToken: string;
  /** The diagnosis-slice updater from `FunnelStateContext`. */
  readonly setDiagnosis: SetDiagnosis;
  /** Optional API origin override (defaults inside `createDiagnosisTransport`). */
  readonly baseUrl?: string;
}

/** Optional dependency overrides for {@link runDiagnosis}. */
export interface RunDiagnosisDeps {
  readonly requestImpl?: DiagnosisRequestImpl;
}

const defaultRequestImpl: DiagnosisRequestImpl = (selfie, accessToken, baseUrl) =>
  requestDiagnosis(
    createDiagnosisTransport(
      baseUrl === undefined
        ? { selfie, accessToken }
        : { selfie, accessToken, baseUrl },
    ),
  );

/**
 * Fire the diagnosis request and record its outcome in the funnel slice.
 *
 * Sequence:
 *   1. flip the slice to `pending` (clearing any prior `errorKind`);
 *   2. await the injected request;
 *   3. on success, store `{ status: 'success', result, errorKind: null }`;
 *   4. on failure, store `{ status: 'error', errorKind }` — the discriminated
 *      {@link DiagnosisErrorKind} from a {@link DiagnosisRequestError}, or
 *      `'unknown'` for any other thrown value (e.g. a network drop).
 *
 * Never throws — every failure path is captured into the slice so the caller
 * (a fire-and-forget `void runDiagnosis(...)` in a mount effect) cannot trip an
 * unhandled rejection.
 *
 * @param params - selfie / token / slice updater / optional base URL.
 * @param deps - optional `requestImpl` override (defaults to the real pipeline).
 */
export async function runDiagnosis(
  params: RunDiagnosisParams,
  deps: RunDiagnosisDeps = {},
): Promise<void> {
  const requestImpl = deps.requestImpl ?? defaultRequestImpl;
  params.setDiagnosis({ status: 'pending', errorKind: null });
  try {
    const result = await requestImpl(params.selfie, params.accessToken, params.baseUrl);
    params.setDiagnosis({ status: 'success', result, errorKind: null });
  } catch (error: unknown) {
    const kind: DiagnosisErrorKind =
      error instanceof DiagnosisRequestError ? error.kind : 'unknown';
    params.setDiagnosis({ status: 'error', errorKind: kind });
  }
}
