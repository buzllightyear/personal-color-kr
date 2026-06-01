"""Unit tests for the referral ``share_url`` builder (Phase 4.5).

Pins the contract of :func:`api.referrals.share_url.build_share_url`:

    * Format: ``{REFERRAL_BASE_URL}/r/{referral_code}`` for sample codes.
    * ``base_url`` may be passed explicitly (deterministic) or resolved from
      the ``REFERRAL_BASE_URL`` env var (single source of truth, server-side).
    * A single/repeated trailing slash on the base is normalized away.
    * Empty/whitespace codes raise ``ValueError``; a missing env var raises
      ``LookupError`` (fail-fast) when ``base_url`` is omitted.
"""

from __future__ import annotations

import pytest

from api.referrals.share_url import REFERRAL_URL_PATH_SEGMENT, build_share_url

# Representative ``secrets.token_urlsafe(6)`` outputs: 8-char URL-safe base64
# (alphanumerics plus the ``-``/``_`` URL-safe alphabet).
_SAMPLE_CODES: tuple[str, ...] = (
    "aB3dEf7h",
    "Xy9zAb2c",
    "AAAAAAAA",
    "a-b_c-d_",
    "0123_456",
)


@pytest.mark.unit
def test_path_segment_is_the_canonical_r_segment() -> None:
    """The path segment mirrors the mobile ``/r/:code`` pattern."""
    assert REFERRAL_URL_PATH_SEGMENT == "r"


@pytest.mark.unit
def test_builds_expected_url_for_sample_code() -> None:
    """The builder produces ``{base}/r/{code}`` for a representative code."""
    url = build_share_url("aB3dEf7h", base_url="https://pcolor.example")
    assert url == "https://pcolor.example/r/aB3dEf7h"


@pytest.mark.unit
@pytest.mark.parametrize("code", _SAMPLE_CODES)
def test_builds_expected_url_for_each_sample_code(code: str) -> None:
    """Every sample code lands at ``{base}/r/{code}`` verbatim."""
    url = build_share_url(code, base_url="https://pcolor.example")
    assert url == f"https://pcolor.example/r/{code}"


@pytest.mark.unit
def test_normalizes_single_trailing_slash_on_base() -> None:
    """A trailing slash on the base does not produce a double slash."""
    url = build_share_url("aB3dEf7h", base_url="https://pcolor.example/")
    assert url == "https://pcolor.example/r/aB3dEf7h"


@pytest.mark.unit
def test_normalizes_repeated_trailing_slashes_on_base() -> None:
    """Repeated trailing slashes collapse to the single ``/r/`` join."""
    url = build_share_url("aB3dEf7h", base_url="https://pcolor.example///")
    assert url == "https://pcolor.example/r/aB3dEf7h"


@pytest.mark.unit
def test_preserves_base_with_path_prefix() -> None:
    """A base that already carries a path prefix is preserved verbatim."""
    url = build_share_url("Xy9zAb2c", base_url="https://host.example/app")
    assert url == "https://host.example/app/r/Xy9zAb2c"


@pytest.mark.unit
def test_resolves_base_url_from_env_when_omitted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When ``base_url`` is omitted the env var is the single source of truth."""
    monkeypatch.setenv("REFERRAL_BASE_URL", "https://env.example")
    url = build_share_url("aB3dEf7h")
    assert url == "https://env.example/r/aB3dEf7h"


@pytest.mark.unit
def test_missing_env_var_raises_lookup_error_when_omitted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A missing ``REFERRAL_BASE_URL`` fails fast (no malformed URL emitted)."""
    monkeypatch.delenv("REFERRAL_BASE_URL", raising=False)
    with pytest.raises(LookupError) as exc_info:
        build_share_url("aB3dEf7h")
    # Names the var, never leaks a value.
    assert "REFERRAL_BASE_URL" in str(exc_info.value)


@pytest.mark.unit
@pytest.mark.parametrize("blank", ["", "   ", "\t", "\n"])
def test_empty_or_whitespace_code_raises_value_error(blank: str) -> None:
    """A blank code is a programming error, not a malformed ``.../r/`` URL."""
    with pytest.raises(ValueError):
        build_share_url(blank, base_url="https://pcolor.example")
