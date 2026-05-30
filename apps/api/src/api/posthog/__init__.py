"""PostHog integration package (Phase 4.4) — pull-only.

This package hosts the PostHog Cohort API *pull* integration. It is
strictly pull-only: the backend reads PostHog cohort *definitions* via
PostHog's REST API; it never pushes server-side ``capture`` events to
PostHog (client-side instrumentation owns capture). The ``events`` table
remains the sole source of truth for retention calculation.

Phase 4.4 ships :mod:`api.posthog.posthog_cohort_client`, an async httpx
client for fetching a single cohort definition by id.
"""

__all__: list[str] = []
