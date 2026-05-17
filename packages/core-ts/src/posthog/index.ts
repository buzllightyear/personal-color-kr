/**
 * Public exports — `posthog` module.
 *
 * PostHogClient wrapper providing a `capture(event, props)` abstraction
 * over the posthog-react-native SDK.  Wiring up the concrete transport
 * (a PostHog instance from posthog-react-native) lives in
 * `apps/mobile`; this package exposes only the framework-agnostic
 * wrapper + contract types so it can be unit-tested with a vi.fn
 * recorder.
 *
 * Keep this file as a pure re-export barrel — coverage config excludes
 * `src/{star}{star}/index.ts` so behavioural code lives in sibling
 * modules.
 */
export {
  PostHogClientError,
  createPostHogClient,
  type CreatePostHogClientOptions,
  type PostHogClient,
  type PostHogClientErrorReason,
  type PostHogProperties,
  type PostHogTransport,
} from './client.js';
