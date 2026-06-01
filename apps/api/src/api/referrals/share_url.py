"""Server-side referral ``share_url`` assembly (Phase 4.5 Sub-AC: builder).

# Why this module exists

The referral feature is built on a single, load-bearing invariant: the
``share_url`` a user shares with a friend is assembled **exclusively
server-side** (Seed: ``single_source_of_truth``). The mobile client carries no
``REFERRAL_BASE_URL`` constant and never concatenates a URL itself — it renders
whatever ``share_url`` the server hands back (from ``GET /v1/referrals/me`` or
the sign-in response). This module is the *one* place that turns a per-user
``referral_code`` into that full URL, so the format can never drift between two
hand-rolled call sites.

# URL format

The canonical referral entry point is the ``/r/:code`` deep-link path
(mirrored on the mobile side by ``REFERRAL_PATH_PATTERN = '/r/:code'`` in
``apps/mobile/src/deep-link-paths.ts``). The builder therefore produces::

    {REFERRAL_BASE_URL}/r/{referral_code}

e.g. ``build_share_url("aB3dEf7h", base_url="https://pcolor.example")`` →
``"https://pcolor.example/r/aB3dEf7h"``.

``REFERRAL_BASE_URL`` is treated as the *origin/base* (``https://host`` or
``https://host/path``); the builder normalizes a single trailing slash so both
``https://pcolor.example`` and ``https://pcolor.example/`` yield the same URL.

# Boundary contract

    * :func:`build_share_url` is a pure string assembly. When ``base_url`` is
      omitted it resolves :func:`api.config.env.require_referral_base_url`
      (fail-fast ``LookupError`` if the env var is unset). Passing ``base_url``
      explicitly keeps the function deterministic for unit tests.
    * An empty / whitespace ``referral_code`` raises :class:`ValueError` rather
      than emitting a malformed ``.../r/`` URL — the code is the load-bearing
      path segment, so a blank one is a programming error worth surfacing.
    * No SQLAlchemy, no httpx — a pure function with an env-config dependency
      only.
"""

from __future__ import annotations

from typing import Final

from api.config.env import require_referral_base_url

# The canonical referral deep-link path segment. Mirrors the mobile
# ``REFERRAL_PATH_PATTERN = '/r/:code'`` so the server-assembled URL resolves
# through the same ``/r/:code`` route the deep-link parser handles.
REFERRAL_URL_PATH_SEGMENT: Final[str] = "r"


def build_share_url(referral_code: str, *, base_url: str | None = None) -> str:
    """Assemble the full referral ``share_url`` for a ``referral_code``.

    Parameters
    ----------
    referral_code:
        The user's per-user fixed 8-char URL-safe referral code
        (``users.referral_code``). Must be non-empty.
    base_url:
        The origin/base to prepend. When ``None`` (the default), the value is
        resolved from the ``REFERRAL_BASE_URL`` env var via
        :func:`api.config.env.require_referral_base_url`. Passing it explicitly
        keeps the function deterministic (used by unit tests).

    Returns
    -------
    str
        ``{base}/r/{referral_code}`` with a single trailing slash on ``base``
        normalized away, e.g. ``https://pcolor.example/r/aB3dEf7h``.

    Raises
    ------
    ValueError
        If ``referral_code`` is empty or whitespace-only.
    LookupError
        If ``base_url`` is omitted and ``REFERRAL_BASE_URL`` is unset/empty.
    """
    if not referral_code or not referral_code.strip():
        raise ValueError(
            "referral_code must be a non-empty string to build a share URL."
        )

    resolved_base = base_url if base_url is not None else require_referral_base_url()
    # Strip a single (or repeated) trailing slash so the join never produces a
    # double slash before the ``/r/`` path segment.
    normalized_base = resolved_base.rstrip("/")
    return f"{normalized_base}/{REFERRAL_URL_PATH_SEGMENT}/{referral_code}"


__all__ = ["REFERRAL_URL_PATH_SEGMENT", "build_share_url"]
