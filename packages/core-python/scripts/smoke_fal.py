#!/usr/bin/env python3
"""Standalone Fal.ai authentication smoke test (Seed Contract AC 10).

# Purpose

The Seed Contract names Fal.ai as a "keys-only" vendor for the MVP:

  * No SDK is bundled into the mobile app — `FAL_API_KEY` must never
    reach a client binary (it would be extractable from the bundle).
  * No FastAPI surface yet — that surface is deferred to Phase 4.

The only way to prove the key works end-to-end *before* Phase 4 is a
standalone script that hits the live Fal.ai API with the operator's
credentials and verifies the platform accepts them. This script is
that proof.

It does NOT live in `tests/` because:

  * `pyproject.toml` declares `testpaths = ["tests"]`, so anything
    under `scripts/` is invisible to pytest auto-discovery and
    therefore cannot pollute the 940 unit tests already in this
    package (the Seed Contract's `test_isolation` principle).
  * It requires a live network round-trip and a real credential. Mixing
    that into the default `pytest` run would either fail in CI (no
    key) or accidentally hammer Fal.ai every time someone runs the
    suite. Keeping it opt-in via `python scripts/smoke_fal.py` is the
    right shape.

# Boundary contract

Inputs (all from `os.environ`, populated either by the root `.env` or
by the operator's shell):

  * `FAL_API_KEY` — required; format `<key_id>:<key_secret>`.

Outputs:

  * `stdout`     — the pretty-printed JSON response from Fal.ai on a
                   successful authenticated round-trip.
  * `stderr`     — diagnostic lines prefixed `[smoke_fal][LEVEL]`.
  * exit code 0  — authenticated request succeeded; key is valid.
  * exit code 1  — configuration error (missing key, malformed value).
  * exit code 2  — network error (connection refused, timeout, DNS).
  * exit code 3  — Fal.ai rejected the credential (HTTP 401 / 403).
  * exit code 4  — Response was non-JSON (unexpected; usually a Fal
                   outage or a misrouted request).

# Why the queue-status endpoint?

Fal.ai exposes a request-status endpoint at
`GET https://queue.fal.run/{app}/requests/{request_id}/status`.

The behaviour we exploit:

  * Valid key + nonexistent request ID → HTTP 404 with a JSON body
    like `{"status": "ERROR", "detail": "..."}`. The auth header was
    accepted, the request lookup failed — exactly the signal we want.
  * Invalid / missing key → HTTP 401 with a JSON body. The auth layer
    short-circuits before the request lookup.

Critically, no model is invoked. The endpoint is read-only metadata,
so the operator does NOT pay credits, does NOT create queue entries,
and does NOT need to clean anything up afterwards. The all-zero UUID
is used so the request will never coincidentally exist for any real
operator.

Run it:

    python packages/core-python/scripts/smoke_fal.py

Or from this script's own directory:

    python scripts/smoke_fal.py
"""

from __future__ import annotations

import json
import ssl
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Final

# ---------------------------------------------------------------------------
# Path bootstrap
# ---------------------------------------------------------------------------
#
# This file lives at `packages/core-python/scripts/smoke_fal.py`. To import
# `config.env` (which is at `packages/core-python/src/config/env.py`) without
# requiring an editable install (`pip install -e .`), we add the package's
# `src/` directory to `sys.path`.
#
# Anchoring on `__file__` rather than `os.getcwd()` keeps resolution stable
# regardless of whether the operator invokes us via:
#     python packages/core-python/scripts/smoke_fal.py    # from repo root
#     python scripts/smoke_fal.py                          # from package dir
#     python ../packages/core-python/scripts/smoke_fal.py  # from elsewhere
#
# Matches the same anchoring pattern used by `config.env._THIS_FILE`.
_THIS_FILE: Final[Path] = Path(__file__).resolve()
_PACKAGE_SRC: Final[Path] = _THIS_FILE.parent.parent / "src"
if str(_PACKAGE_SRC) not in sys.path:
    sys.path.insert(0, str(_PACKAGE_SRC))

# `noqa: E402` — the import must follow the `sys.path` mutation above, which
# is the documented Python idiom for in-tree scripts that depend on a
# non-installed sibling package. There is no way to avoid this ordering
# without forcing an `editable install` step that the Seed Contract does not
# mandate.
from config.env import (  # noqa: E402
    find_root_dotenv,
    get_env,
    load_root_dotenv,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# The all-zero UUID is reserved for the smoke test. It is astronomically
# unlikely to collide with a real Fal request ID, so the 404 path is stable.
_NONEXISTENT_REQUEST_ID: Final[str] = "00000000-0000-0000-0000-000000000000"

# Pinned model namespace (`fal-ai/fast-sdxl`) — a public, long-standing Fal
# app whose queue endpoint has been stable since 2023. Choosing a pinned
# model rather than a runtime-discovered one means the smoke script does
# not need any other API call to function.
_FAL_AUTH_PROBE_URL: Final[str] = (
    "https://queue.fal.run/fal-ai/fast-sdxl/requests/"
    f"{_NONEXISTENT_REQUEST_ID}/status"
)

# 15 seconds is generous for a single status-lookup round-trip. Fal's queue
# API typically responds in <1s; we pad for slow CI runners or transient
# regional routing hiccups but still fail fast on a true outage.
_TIMEOUT_SECONDS: Final[float] = 15.0

# Identify ourselves so Fal's observability team can correlate spikes if a
# misconfigured CI somehow loops this script. Generic enough not to leak
# customer-identifying information.
_USER_AGENT: Final[str] = "personal-color-kr-smoke-fal/1.0"

# Exit codes — keep in sync with the boundary contract in the module docstring.
_EXIT_OK: Final[int] = 0
_EXIT_CONFIG: Final[int] = 1
_EXIT_NETWORK: Final[int] = 2
_EXIT_AUTH_REJECTED: Final[int] = 3
_EXIT_NON_JSON: Final[int] = 4


def _build_ssl_context() -> ssl.SSLContext:
    """Build an SSL context that works across varied Python installs.

    System Python on macOS frequently ships *without* a usable CA bundle
    in the default context (the `Install Certificates.command` workaround
    exists precisely because of this). Linux distros and pyenv installs
    usually pick up `/etc/ssl/certs/...` automatically. To smooth over
    that platform variance for a smoke script that MUST hit a real HTTPS
    endpoint, we:

      1. Try to import `certifi` (a transitive dep of `requests` /
         `pip` / many other packages — often already present even when
         not declared) and point the SSL context at its bundled CA list.
      2. Fall back to `ssl.create_default_context()` if `certifi` is not
         importable. On a well-configured Python, that path Just Works.

    `certifi` is intentionally NOT added to `pyproject.toml` because:

      * It would inflate the runtime closure of `core-python` for every
        non-smoke consumer (which is most of them).
      * The 940-test pytest suite does not need it.
      * Operators running this script in a real venv almost always have
        it already (it ships transitively with `pip`, `requests`,
        `httpx`, `urllib3`, etc.).

    The function never raises — a misconfigured SSL stack will surface
    later as a `URLError` from `urlopen`, which `_probe_fal` translates
    into a clean `_EXIT_NETWORK` failure with operator guidance.
    """
    try:
        import certifi  # noqa: PLC0415  (intentional lazy / optional import)
    except ImportError:
        return ssl.create_default_context()
    return ssl.create_default_context(cafile=certifi.where())


# ---------------------------------------------------------------------------
# Diagnostic helpers
# ---------------------------------------------------------------------------


def _log(level: str, message: str) -> None:
    """Emit a single `[smoke_fal][LEVEL] ...` line to stderr.

    Going through a thin helper keeps the prefix consistent and trivially
    greppable from CI logs. We deliberately avoid the `logging` module to
    keep the script self-contained — `logging.basicConfig()` would clash
    with whatever the parent process has already configured.
    """
    print(f"[smoke_fal][{level}] {message}", file=sys.stderr)


def _mask_key(api_key: str) -> str:
    """Return a debug-safe rendering of the key.

    Shows the first six and last four characters with an ellipsis between.
    For a typical Fal key like `key-id-12345:secret-67890abcdef`, this
    yields `'key-id…cdef'` — enough to distinguish two keys in a log,
    nowhere near enough to reconstruct the original.
    """
    if len(api_key) <= 10:
        # Don't bother masking obviously-invalid short values; the caller's
        # format check will reject these before any HTTP call goes out.
        return "<short>"
    return f"{api_key[:6]}…{api_key[-4:]}"


# ---------------------------------------------------------------------------
# Main flow
# ---------------------------------------------------------------------------


def _load_env_or_warn() -> None:
    """Best-effort load of the root `.env`.

    A missing `.env` is *not* fatal here — the operator may have exported
    `FAL_API_KEY` directly (CI secret, `direnv`, etc.). The actual fatal
    check happens in `get_env(..., required=True)` below, which fails
    with a precise error message that includes the resolved `.env` path
    (or `<no .env found>` if the file is unreachable).
    """
    dotenv_path = find_root_dotenv()
    loaded = load_root_dotenv()
    if dotenv_path is None or not loaded:
        _log(
            "WARN",
            "No root .env file discovered. Falling back to exported "
            "environment variables. If FAL_API_KEY is unset, the next "
            "step will fail with a precise location hint.",
        )
        return
    _log("INFO", f"Loaded root .env from: {dotenv_path}")


def _read_api_key() -> str | int:
    """Fetch and validate `FAL_API_KEY`.

    Returns the key string on success, or an exit code on failure so the
    caller can `sys.exit(...)` without re-raising.
    """
    try:
        api_key = get_env("FAL_API_KEY", required=True)
    except LookupError as exc:
        _log("FAIL", str(exc))
        return _EXIT_CONFIG
    # `get_env(required=True)` guarantees a non-empty string, so this is a
    # tautological assertion for type-checkers rather than a runtime safety
    # net. Keep it explicit so mypy/pyright can narrow `str | None` → `str`.
    assert api_key is not None and api_key != ""

    # Soft format check. Real Fal keys are `<key_id>:<key_secret>`. The
    # placeholder shipped in `.env.example`
    # (`REPLACE_WITH_FAL_KEY_FROM_https_fal_ai_dashboard_keys`) contains
    # no colon, so this catches the "I forgot to populate `.env`" case
    # *before* spending a network round-trip on a guaranteed 401.
    if ":" not in api_key:
        _log(
            "FAIL",
            "FAL_API_KEY does not match the expected '<key_id>:<key_secret>' "
            "format. Replace the placeholder in .env with a real key from "
            "https://fal.ai/dashboard/keys.",
        )
        return _EXIT_CONFIG

    _log(
        "INFO",
        f"Using FAL_API_KEY (masked: {_mask_key(api_key)}, "
        f"length: {len(api_key)}).",
    )
    return api_key


def _probe_fal(api_key: str) -> tuple[int, bytes] | int:
    """Send the authenticated probe; return `(status, body)` or exit code.

    Treats `urllib.error.HTTPError` as a successful round-trip (we want
    the status code and JSON body from 4xx responses) and treats
    `URLError` / `TimeoutError` as genuine network failures.
    """
    request = urllib.request.Request(
        _FAL_AUTH_PROBE_URL,
        method="GET",
        headers={
            # Fal.ai's auth contract: `Authorization: Key <key>`.
            # The literal `Key ` prefix (note the space) is required — Fal
            # does not accept the `Bearer` scheme.
            "Authorization": f"Key {api_key}",
            "Accept": "application/json",
            "User-Agent": _USER_AGENT,
        },
    )

    ssl_context = _build_ssl_context()

    try:
        # `urlopen` returns a `HTTPResponse` for 2xx/3xx (after following
        # redirects up to its default limit). Use a context manager so the
        # socket is closed even on read errors.
        # Bandit B310 (`urllib.request.urlopen`) is a false positive here:
        # we control the URL via a module-level constant — there is no
        # path for user-supplied input to influence the request target.
        with urllib.request.urlopen(  # noqa: S310
            request, timeout=_TIMEOUT_SECONDS, context=ssl_context
        ) as response:
            return response.getcode(), response.read()
    except urllib.error.HTTPError as http_err:
        # 4xx/5xx land here. We still want the body — that's where Fal
        # puts the auth-failure detail JSON.
        body = http_err.read() or b""
        return http_err.code, body
    except urllib.error.URLError as url_err:
        _log(
            "FAIL",
            f"Network error reaching {_FAL_AUTH_PROBE_URL}: {url_err.reason}. "
            "Check connectivity and Fal.ai status (https://status.fal.ai).",
        )
        return _EXIT_NETWORK
    except TimeoutError:
        # Python 3.11+: `socket.timeout` is now an alias of `TimeoutError`.
        _log(
            "FAIL",
            f"Timed out after {_TIMEOUT_SECONDS}s contacting "
            f"{_FAL_AUTH_PROBE_URL}. Retry once before declaring an outage.",
        )
        return _EXIT_NETWORK


def _interpret_response(status_code: int, raw_body: bytes) -> int:
    """Map the raw response to an exit code, emitting diagnostics.

    The decision tree:

      1. Body must be JSON-decodable. Anything else means Fal returned an
         error page or a malformed body — treat as exit-4.
      2. HTTP 401 or 403 means the auth header was rejected — exit-3.
      3. Any other status (200 / 404 / 422 / etc.) means the auth header
         was accepted by Fal's middleware — exit-0. The smoke test does
         NOT enforce a specific status because Fal is free to change the
         shape of "request not found" responses; we only care that the
         credential survives the auth layer.
    """
    try:
        # Empty body → parse as JSON `null` so json.loads doesn't raise.
        text = raw_body.decode("utf-8")
    except UnicodeDecodeError as decode_err:
        snippet = raw_body[:200]
        _log(
            "FAIL",
            f"Non-UTF8 response body from Fal.ai (HTTP {status_code}): "
            f"{decode_err}. First 200 bytes: {snippet!r}",
        )
        return _EXIT_NON_JSON

    try:
        body: Any = json.loads(text or "null")
    except json.JSONDecodeError as decode_err:
        snippet = text[:200]
        _log(
            "FAIL",
            f"Non-JSON response from Fal.ai (HTTP {status_code}): "
            f"{decode_err}. First 200 chars: {snippet!r}",
        )
        return _EXIT_NON_JSON

    if status_code in (401, 403):
        _log(
            "FAIL",
            f"Fal.ai rejected the credential with HTTP {status_code}. "
            f"Body: {body!r}. "
            "Verify FAL_API_KEY in .env matches a key listed at "
            "https://fal.ai/dashboard/keys.",
        )
        return _EXIT_AUTH_REJECTED

    # Auth accepted. Pretty-print the JSON to stdout so a human (or a CI
    # log scraper) can see exactly what Fal returned. `ensure_ascii=False`
    # so any non-ASCII detail strings (Fal does occasionally include
    # Korean/Japanese characters in error details) survive intact.
    print(json.dumps(body, indent=2, ensure_ascii=False))
    _log(
        "OK",
        f"Authenticated round-trip succeeded (HTTP {status_code}). "
        "FAL_API_KEY is valid.",
    )
    return _EXIT_OK


def main() -> int:
    """End-to-end orchestration. Returns the process exit code."""
    _load_env_or_warn()

    key_or_exit = _read_api_key()
    if isinstance(key_or_exit, int):
        return key_or_exit
    api_key: str = key_or_exit

    probe_result = _probe_fal(api_key)
    if isinstance(probe_result, int):
        return probe_result
    status_code, raw_body = probe_result

    return _interpret_response(status_code, raw_body)


if __name__ == "__main__":
    sys.exit(main())
