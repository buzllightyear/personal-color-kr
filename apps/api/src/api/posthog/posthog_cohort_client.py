"""PostHog Cohort API pull client (Phase 4.4) — async, httpx, pull-only.

Fetches a single PostHog cohort *definition* by id from PostHog's
project-scoped REST API:

    GET {host}/api/projects/{project_id}/cohorts/{cohort_id}
    Authorization: Bearer {personal_api_key}

# Why pull-only

The Seed pins this integration as pull-only: we read cohort *definitions*
(the operator's PostHog-side audience segments) so a later phase can map
them onto the local ``events`` table. We never push server-side capture
to PostHog — client-side instrumentation owns capture, and the local
``events`` table stays the single source of truth for retention.

# Dependency discipline

Uses ``httpx`` (already a runtime dependency promoted in Phase 4.3 for the
Apple JWKS client) for the async request. No new runtime dependency is
introduced. The client mirrors the
:class:`api.auth.apple_jwks.AppleJwksClient` test seam: an optional
``http_client_factory`` lets unit tests inject an
``httpx.AsyncClient(transport=httpx.MockTransport(...))`` without touching
the real PostHog endpoint.

# Secret hygiene

The Personal API Key is read via
:func:`api.config.env.require_posthog_personal_api_key` and sent only in
the ``Authorization`` header. It is never logged, never embedded in an
exception message, and never returned in any response body.

# Error surface

Network failures, non-2xx responses, and malformed JSON are surfaced as
:class:`PostHogCohortError` so the caller maps them to an HTTP status
without leaking transport internals.
"""

from __future__ import annotations

from typing import Any, Callable

import httpx

from api.config.env import (
    require_posthog_personal_api_key,
    require_posthog_project_id,
)

#: PostHog cloud host. The US cloud default; EU cloud
#: (``https://eu.posthog.com``) or a self-hosted instance can be supplied
#: via the ``host`` constructor argument.
DEFAULT_POSTHOG_HOST: str = "https://app.posthog.com"

#: Hard timeout (seconds) for the cohort fetch. PostHog's API is
#: CDN-fronted and responds quickly in steady state; a generous ceiling
#: lets a transient connection burst recover.
COHORT_FETCH_TIMEOUT_SECONDS: float = 10.0


class PostHogCohortError(RuntimeError):
    """Raised when a PostHog cohort fetch fails (network, HTTP, or parse).

    Carries a stable, secret-free message. The originating exception is
    chained via ``raise ... from exc`` so server logs retain the cause
    without the message itself leaking the Personal API Key.
    """


class PostHogCohortClient:
    """Async client that pulls a single PostHog cohort definition by id.

    Parameters
    ----------
    host:
        PostHog instance base URL (no trailing slash required). Defaults
        to :data:`DEFAULT_POSTHOG_HOST`.
    timeout_seconds:
        Per-request timeout. Defaults to
        :data:`COHORT_FETCH_TIMEOUT_SECONDS`.
    http_client_factory:
        Optional zero-arg callable returning an ``httpx.AsyncClient``.
        Unit tests inject a ``MockTransport``-backed client here; in
        production the client is constructed inline with the configured
        timeout.
    """

    def __init__(
        self,
        *,
        host: str = DEFAULT_POSTHOG_HOST,
        timeout_seconds: float = COHORT_FETCH_TIMEOUT_SECONDS,
        http_client_factory: Callable[[], httpx.AsyncClient] | None = None,
    ) -> None:
        self._host = host.rstrip("/")
        self._timeout_seconds = timeout_seconds
        self._http_client_factory = http_client_factory

    def _cohort_url(self, project_id: str, cohort_id: int) -> str:
        """Build the project-scoped cohort URL for ``cohort_id``."""
        return f"{self._host}/api/projects/{project_id}/cohorts/{cohort_id}"

    async def fetch_cohort(self, cohort_id: int) -> dict[str, Any]:
        """Fetch and return the PostHog cohort definition for ``cohort_id``.

        Reads ``POSTHOG_PERSONAL_API_KEY`` and ``POSTHOG_PROJECT_ID`` from
        the environment (fail-fast via the ``require_*`` accessors),
        issues an authenticated ``GET`` against the project-scoped cohort
        endpoint, and returns the parsed JSON object.

        Parameters
        ----------
        cohort_id:
            The PostHog cohort identifier to fetch.

        Returns
        -------
        dict[str, Any]
            The decoded cohort definition JSON object.

        Raises
        ------
        PostHogCohortError
            On any network error, non-2xx HTTP status, or non-object /
            non-JSON response body.
        """
        api_key = require_posthog_personal_api_key()
        project_id = require_posthog_project_id()
        url = self._cohort_url(project_id, cohort_id)
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
        }

        if self._http_client_factory is not None:
            client = self._http_client_factory()
        else:
            client = httpx.AsyncClient(timeout=self._timeout_seconds)
        try:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            document = response.json()
        except httpx.HTTPStatusError as exc:
            raise PostHogCohortError(
                f"PostHog cohort fetch returned HTTP {exc.response.status_code} "
                f"for cohort {cohort_id}."
            ) from exc
        except httpx.HTTPError as exc:
            raise PostHogCohortError(
                f"PostHog cohort fetch failed for cohort {cohort_id} "
                "(transport error)."
            ) from exc
        except ValueError as exc:
            raise PostHogCohortError(
                f"PostHog cohort fetch for cohort {cohort_id} returned a "
                "non-JSON body."
            ) from exc
        finally:
            await client.aclose()

        if not isinstance(document, dict):
            raise PostHogCohortError(
                f"PostHog cohort fetch for cohort {cohort_id} returned a "
                f"{type(document).__name__}, expected a JSON object."
            )
        return document


__all__ = [
    "COHORT_FETCH_TIMEOUT_SECONDS",
    "DEFAULT_POSTHOG_HOST",
    "PostHogCohortClient",
    "PostHogCohortError",
]
