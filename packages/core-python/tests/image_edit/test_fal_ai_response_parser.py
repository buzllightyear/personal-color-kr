"""Tests for the Fal.ai img2img response parser (Sub-AC 4.3).

# What this file pins down

:func:`image_edit.fal_ai_vendor_caller._parse_img2img_response` is the
*pure* function that translates the already-decoded JSON body of a
successful ``fal-ai/flux/dev/image-to-image`` 200 response into the
single string the adapter forwards to the download step (``images[0].url``).
This file pins:

  * The allowlist discipline — *exactly one* field
    (``images[0].url``) crosses the layer boundary; every other field
    in the body (``seed``, ``request_id``, echoed ``prompt``, NSFW
    flags, model timings) is implicitly discarded.
  * The exact JSON paths Fal documents (``images`` is the array key,
    ``url`` is the per-image URL key).
  * The error-classification rules the outer ``edit_image`` retry
    loop depends on: every contract violation surfaces as
    :class:`ValueError` so the loop short-circuits immediately —
    retrying a malformed response would only produce the same
    malformed response.
  * Redaction discipline in exception messages — the parser names
    the offending *field* but never echoes the offending value,
    because Fal's response can legitimately carry request-tracking
    tokens that would become redaction targets if they reached a log
    record via ``logger.exception(...)``.
  * Purity: the function does no I/O, no logging, has no module-level
    side effects, allocates no shared buffer, and returns a single
    string per call.

# Why a dedicated test file?

Sibling AC tests (``test_fal_ai_api_key.py``, ``test_fal_ai_defaults.py``,
``test_fal_ai_preset_to_prompt.py``, ``test_fal_ai_upload_step.py``,
``test_fal_ai_request_builder.py``, ``test_fal_ai_edit_step.py``)
intentionally scope themselves to a single concern. Keeping the
response-parser tests in their own file mirrors that structure and
parallels the request-builder file layout almost exactly so reviewers
can A/B the two. Phase 4's FastAPI form-default reuse will adopt the
same parser without disturbing the integration-shaped edit-step
tests that exercise the HTTP round-trip around it.

# Why pure-function tests (no httpx, no monkeypatch)?

The parser takes ``object`` and returns ``str``. It never imports
network code, never reads the environment, never allocates a logger
record, and never opens an httpx client. Exercising it as a pure
function — without any transport mock — is the strongest possible
isolation: a regression that accidentally introduces I/O into the
parser will fail to import or run within this file's tight (no
fixtures, no setup/teardown) test budget.
"""

from __future__ import annotations

import logging
from types import MappingProxyType
from typing import Any, Final

import pytest

from image_edit.fal_ai_vendor_caller import (
    _FAL_IMG2IMG_RESPONSE_IMAGE_URL_KEY,
    _FAL_IMG2IMG_RESPONSE_IMAGES_KEY,
    _parse_img2img_response,
)

# ---------------------------------------------------------------------------
# Canonical fixtures
# ---------------------------------------------------------------------------
#
# Distinctive enough that an accidental leak into a log or an
# exception message would be obvious in test output. We deliberately
# do NOT reuse the edit-step's ``_FAKE_RESULT_URL`` constant — these
# tests live in their own file so they cannot share that fixture, and
# inlining a constant locally keeps failure messages readable.
_FAKE_RESULT_URL: Final[str] = (
    "https://v3.fal.media/files/giraffe/parser-test-result-canary.png"
)

# A leak-canary substring. Tests assert this never appears in any
# exception message — proving the parser names the offending *field*
# but never echoes the offending *value*. Picked to be obvious in
# test output without resembling any legitimate URL fragment.
_LEAK_CANARY: Final[str] = "PARSER-LEAK-CANARY-do-not-echo-9f7a"


def _ok_body() -> dict[str, object]:
    """Build a minimal well-formed response body for happy-path tests.

    Includes a handful of extra top-level and per-image fields so the
    "extras are discarded" allowlist assertion has something to bite
    on. The canonical happy-path body for the edit-step tests carries
    the same shape, so a regression that desynchronises the two
    fixtures fails this file's tests immediately.
    """
    return {
        _FAL_IMG2IMG_RESPONSE_IMAGES_KEY: [
            {
                _FAL_IMG2IMG_RESPONSE_IMAGE_URL_KEY: _FAKE_RESULT_URL,
                # Extra per-image fields the allowlist must discard.
                "width": 1024,
                "height": 1024,
                "content_type": "image/png",
            },
        ],
        # Extra top-level fields the allowlist must discard.
        "seed": 42,
        "has_nsfw_concepts": [False],
        "prompt": "echoed prompt — must not leak",
        "request_id": "extra-request-id",
        "timings": {"inference": 12.34},
    }


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_parse_returns_images_zero_url_verbatim() -> None:
    """A well-formed body yields exactly ``images[0].url`` unchanged."""
    body = _ok_body()
    url = _parse_img2img_response(body)
    assert url == _FAKE_RESULT_URL


@pytest.mark.unit
def test_parse_return_type_is_str() -> None:
    """The return type is ``str`` — never bytes, dict, or Response."""
    body = _ok_body()
    result = _parse_img2img_response(body)
    assert isinstance(result, str)


@pytest.mark.unit
def test_parse_does_not_mutate_input_body() -> None:
    """The parser is read-only — input dict is untouched after the call."""
    body = _ok_body()
    # Materialise a deep-enough snapshot via JSON round-trip so a
    # regression that mutates ``images[0]`` (rather than the top-level
    # dict) is caught too.
    import copy

    snapshot = copy.deepcopy(body)
    _parse_img2img_response(body)
    assert body == snapshot, (
        "parser mutated its input — must be read-only so the same body "
        "can be inspected/logged elsewhere without race risk"
    )


@pytest.mark.unit
def test_parse_picks_first_when_images_array_has_many() -> None:
    """Multi-image responses pick ``images[0]`` — never any later entry.

    Fal returns ``num_outputs`` entries when the caller asks for
    multiples, but the adapter's contract is "one selfie in → one
    edited selfie out". A future AC that adds multi-output support
    must widen the parser's return type explicitly; silently picking
    a later entry would hide that contract change.
    """
    body = {
        _FAL_IMG2IMG_RESPONSE_IMAGES_KEY: [
            {_FAL_IMG2IMG_RESPONSE_IMAGE_URL_KEY: _FAKE_RESULT_URL},
            {_FAL_IMG2IMG_RESPONSE_IMAGE_URL_KEY: "https://v3.fal.media/SECOND"},
            {_FAL_IMG2IMG_RESPONSE_IMAGE_URL_KEY: "https://v3.fal.media/THIRD"},
        ],
    }
    assert _parse_img2img_response(body) == _FAKE_RESULT_URL


@pytest.mark.unit
def test_parse_accepts_mapping_proxy_input() -> None:
    """The parser accepts any ``Mapping`` — read-only proxies must work.

    ``json.loads`` always returns a ``dict``, but downstream callers
    (e.g. Phase 4's FastAPI form handler caching parsed responses)
    may freeze the body via :class:`types.MappingProxyType` before
    reuse. The parser must tolerate that without copying.
    """
    raw: dict[str, object] = {
        _FAL_IMG2IMG_RESPONSE_IMAGES_KEY: [
            {_FAL_IMG2IMG_RESPONSE_IMAGE_URL_KEY: _FAKE_RESULT_URL}
        ],
    }
    frozen: Any = MappingProxyType(raw)
    assert _parse_img2img_response(frozen) == _FAKE_RESULT_URL


@pytest.mark.unit
def test_parse_accepts_minimal_one_field_body() -> None:
    """``{"images": [{"url": ...}]}`` is sufficient — no other field required."""
    body: dict[str, object] = {
        _FAL_IMG2IMG_RESPONSE_IMAGES_KEY: [
            {_FAL_IMG2IMG_RESPONSE_IMAGE_URL_KEY: _FAKE_RESULT_URL}
        ],
    }
    assert _parse_img2img_response(body) == _FAKE_RESULT_URL


@pytest.mark.unit
def test_parse_accepts_minimal_first_image_with_only_url() -> None:
    """``images[0]`` may carry only ``url`` — extras are not required."""
    body: dict[str, object] = {
        _FAL_IMG2IMG_RESPONSE_IMAGES_KEY: [
            {_FAL_IMG2IMG_RESPONSE_IMAGE_URL_KEY: _FAKE_RESULT_URL}
        ],
    }
    assert _parse_img2img_response(body) == _FAKE_RESULT_URL


# ---------------------------------------------------------------------------
# Allowlist: extras are discarded
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_parse_discards_extra_top_level_fields() -> None:
    """Top-level keys other than ``images`` never reach the caller."""
    body = {
        _FAL_IMG2IMG_RESPONSE_IMAGES_KEY: [
            {_FAL_IMG2IMG_RESPONSE_IMAGE_URL_KEY: _FAKE_RESULT_URL}
        ],
        # Anything an attacker (or a future Fal release) could stuff
        # into the response. None of these must reach the caller.
        "seed": 9999,
        "request_id": "should-not-escape",
        "prompt": "echoed prompt must not escape",
        "has_nsfw_concepts": [True],
        "timings": {"inference": 99.99},
        "x_fal_token": "should-not-escape-either",
    }
    result = _parse_img2img_response(body)
    # The parser returns *only* the allowlisted URL string — there is
    # no other surface area for the extras to ride out on. We assert
    # by exact equality and by negative containment on the canary
    # values.
    assert result == _FAKE_RESULT_URL
    assert "should-not-escape" not in result
    assert "echoed prompt" not in result
    assert "x_fal_token" not in result


@pytest.mark.unit
def test_parse_discards_extra_per_image_fields() -> None:
    """Per-image keys other than ``url`` never reach the caller."""
    body = {
        _FAL_IMG2IMG_RESPONSE_IMAGES_KEY: [
            {
                _FAL_IMG2IMG_RESPONSE_IMAGE_URL_KEY: _FAKE_RESULT_URL,
                "width": 1024,
                "height": 1024,
                "content_type": "image/png",
                "file_size": 9876543,
                "embed_metadata": "should-not-escape",
            }
        ],
    }
    result = _parse_img2img_response(body)
    assert result == _FAKE_RESULT_URL
    assert "should-not-escape" not in result


# ---------------------------------------------------------------------------
# Error classification: every contract violation → ValueError
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "body",
    [
        # Bare scalars — not JSON objects at all.
        None,
        "a string body",
        42,
        3.14,
        True,
        False,
        # JSON array root (Fal sometimes returns an array on errors).
        ["images", "is", "not", "a", "key"],
        # Empty list, tuple, set — none of these implement Mapping.
        [],
        (),
        set(),
    ],
)
def test_parse_non_mapping_body_raises_value_error(body: object) -> None:
    """A non-object body is a contract violation — non-retryable."""
    with pytest.raises(ValueError, match="not a JSON object"):
        _parse_img2img_response(body)


@pytest.mark.unit
def test_parse_missing_images_key_raises_value_error() -> None:
    """No ``images`` field anywhere in the body."""
    body: dict[str, object] = {"seed": 42, "request_id": "x"}
    with pytest.raises(ValueError, match="missing non-empty"):
        _parse_img2img_response(body)


@pytest.mark.unit
def test_parse_null_images_raises_value_error() -> None:
    """A literal ``null`` ``images`` field (not omitted, but ``None``)."""
    body: dict[str, object] = {_FAL_IMG2IMG_RESPONSE_IMAGES_KEY: None}
    with pytest.raises(ValueError, match="missing non-empty"):
        _parse_img2img_response(body)


@pytest.mark.unit
@pytest.mark.parametrize(
    "images",
    [
        {"not": "a list"},  # JSON object
        "string-not-a-list",
        42,
        True,
        # Tuples / sets are not lists. Fal's JSON contract guarantees a
        # list specifically; accepting a tuple here would be lenient
        # in a way that hides a future contract change.
        ("tuple", "not", "list"),
    ],
)
def test_parse_non_list_images_raises_value_error(images: object) -> None:
    """``images`` must be a JSON list — never an object/string/int."""
    body: dict[str, object] = {_FAL_IMG2IMG_RESPONSE_IMAGES_KEY: images}
    with pytest.raises(ValueError, match="missing non-empty"):
        _parse_img2img_response(body)


@pytest.mark.unit
def test_parse_empty_images_array_raises_value_error() -> None:
    """An empty ``images`` array has no URL to extract — non-retryable."""
    body: dict[str, object] = {_FAL_IMG2IMG_RESPONSE_IMAGES_KEY: []}
    with pytest.raises(ValueError, match="missing non-empty"):
        _parse_img2img_response(body)


@pytest.mark.unit
@pytest.mark.parametrize(
    "first",
    [
        "not-an-object",  # bare string
        12345,  # bare number
        None,  # null
        True,  # bool
        ["nested", "list"],  # nested list
    ],
)
def test_parse_non_mapping_first_image_raises_value_error(first: object) -> None:
    """``images[0]`` must itself be a JSON object."""
    body: dict[str, object] = {_FAL_IMG2IMG_RESPONSE_IMAGES_KEY: [first]}
    with pytest.raises(ValueError, match=r"\[0\] was not a JSON object"):
        _parse_img2img_response(body)


@pytest.mark.unit
def test_parse_missing_url_in_first_image_raises_value_error() -> None:
    """``images[0]`` without a ``url`` field is non-retryable."""
    body: dict[str, object] = {
        _FAL_IMG2IMG_RESPONSE_IMAGES_KEY: [{"width": 1024, "height": 1024}],
    }
    with pytest.raises(ValueError, match="missing required"):
        _parse_img2img_response(body)


@pytest.mark.unit
def test_parse_empty_url_in_first_image_raises_value_error() -> None:
    """An empty ``images[0].url`` is not actionable downstream — reject.

    Without this check, :func:`urllib.parse.urlparse` would happily
    produce a "valid" but useless URL and the download step would
    fail with an opaque transport error far from the root cause.
    """
    body: dict[str, object] = {
        _FAL_IMG2IMG_RESPONSE_IMAGES_KEY: [{_FAL_IMG2IMG_RESPONSE_IMAGE_URL_KEY: ""}],
    }
    with pytest.raises(ValueError, match="missing required"):
        _parse_img2img_response(body)


@pytest.mark.unit
@pytest.mark.parametrize(
    "url_value",
    [
        12345,  # int
        12.5,  # float
        True,  # bool (treat as wrong type, not as truthy "1")
        None,  # null
        ["https://", "fragmented"],  # list
        {"href": "https://..."},  # nested object
    ],
)
def test_parse_non_string_url_in_first_image_raises_value_error(
    url_value: object,
) -> None:
    """A non-string ``images[0].url`` (int, null, list, etc.) is non-retryable."""
    body: dict[str, object] = {
        _FAL_IMG2IMG_RESPONSE_IMAGES_KEY: [
            {_FAL_IMG2IMG_RESPONSE_IMAGE_URL_KEY: url_value}
        ],
    }
    with pytest.raises(ValueError, match="missing required"):
        _parse_img2img_response(body)


# ---------------------------------------------------------------------------
# Redaction discipline in exception messages
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_parse_error_message_names_field_not_value() -> None:
    """Exception messages reference field names, never offending values.

    Echoing the value would risk leaking the API key (if a misroute
    returned an echo of the request), a storage URL (if Fal echoes
    ``image_url``), or fragments of the user's selfie metadata. Naming
    the field is enough for an operator to diagnose; reproducing the
    value is not.
    """
    body: dict[str, object] = {
        _FAL_IMG2IMG_RESPONSE_IMAGES_KEY: [
            {_FAL_IMG2IMG_RESPONSE_IMAGE_URL_KEY: _LEAK_CANARY}
        ],
        "request_id": _LEAK_CANARY,
        "prompt": _LEAK_CANARY,
        # Even a valid response carrying a canary URL must not echo
        # that canary into a downstream log — we exercise the happy
        # path's *exception-free* return path here and the negative
        # path via the other parametrised cases below.
    }
    # Sanity: this body is well-formed so the parser returns the URL.
    assert _parse_img2img_response(body) == _LEAK_CANARY

    # Now exercise an exception path with a canary value. The
    # exception message must NOT contain the offending value.
    bad: dict[str, object] = {
        _FAL_IMG2IMG_RESPONSE_IMAGES_KEY: [
            {_FAL_IMG2IMG_RESPONSE_IMAGE_URL_KEY: 12345}  # wrong type
        ],
        # Stash the canary in extra fields too — to catch a regression
        # that started echoing the whole body in the exception message.
        "request_id": _LEAK_CANARY,
    }
    with pytest.raises(ValueError) as excinfo:
        _parse_img2img_response(bad)
    assert _LEAK_CANARY not in str(excinfo.value), (
        "parser exception leaked the canary value — must name only the "
        "offending field, never echo the offending value or sibling fields"
    )


@pytest.mark.unit
def test_parse_error_messages_never_echo_canary_value() -> None:
    """Across every error branch, no exception message echoes the canary.

    Sweeps every error-classification branch with a body that stashes
    the canary in a field the parser *might* be tempted to echo if a
    regression introduced naive string formatting on the input.
    """
    branches: list[object] = [
        # Non-mapping body
        _LEAK_CANARY,
        [_LEAK_CANARY],
        # Missing/empty/wrong-type images
        {"unrelated": _LEAK_CANARY},
        {_FAL_IMG2IMG_RESPONSE_IMAGES_KEY: _LEAK_CANARY},
        {_FAL_IMG2IMG_RESPONSE_IMAGES_KEY: []},
        # First image not a mapping
        {_FAL_IMG2IMG_RESPONSE_IMAGES_KEY: [_LEAK_CANARY]},
        # Missing url
        {
            _FAL_IMG2IMG_RESPONSE_IMAGES_KEY: [
                {"other": _LEAK_CANARY},
            ]
        },
        # Wrong-type url
        {
            _FAL_IMG2IMG_RESPONSE_IMAGES_KEY: [
                {_FAL_IMG2IMG_RESPONSE_IMAGE_URL_KEY: 12345, "echo": _LEAK_CANARY}
            ]
        },
        # Empty url
        {
            _FAL_IMG2IMG_RESPONSE_IMAGES_KEY: [
                {_FAL_IMG2IMG_RESPONSE_IMAGE_URL_KEY: "", "echo": _LEAK_CANARY}
            ]
        },
    ]
    for body in branches:
        with pytest.raises(ValueError) as excinfo:
            _parse_img2img_response(body)
        assert _LEAK_CANARY not in str(
            excinfo.value
        ), f"branch leaked canary into exception message: body={body!r}"


@pytest.mark.unit
def test_parse_does_not_emit_log_records(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The pure parser emits no log records at any level — observability
    lives one layer up (:meth:`_post_img2img_request`) where the
    elapsed-time breadcrumb is meaningful.
    """
    with caplog.at_level(logging.DEBUG):
        _parse_img2img_response(_ok_body())
        # Also exercise an error branch — the parser still must not log.
        with pytest.raises(ValueError):
            _parse_img2img_response({"no-images-key": True})
    parser_records = [
        r
        for r in caplog.records
        if r.name.startswith("image_edit.fal_ai_vendor_caller")
    ]
    assert parser_records == [], (
        "pure parser emitted log records — observability belongs to "
        "the surrounding HTTP step, not to the schema-checking helper"
    )


# ---------------------------------------------------------------------------
# Statelessness / thread safety surface
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_parse_is_idempotent_across_repeated_calls() -> None:
    """Repeated calls on the same body return the same string — no caching."""
    body = _ok_body()
    first = _parse_img2img_response(body)
    second = _parse_img2img_response(body)
    third = _parse_img2img_response(body)
    assert first == second == third == _FAKE_RESULT_URL


@pytest.mark.unit
def test_parse_distinct_inputs_yield_distinct_outputs() -> None:
    """Different bodies → different URLs — proves no hidden shared state."""
    body_a = {
        _FAL_IMG2IMG_RESPONSE_IMAGES_KEY: [
            {_FAL_IMG2IMG_RESPONSE_IMAGE_URL_KEY: "https://v3.fal.media/A"}
        ],
    }
    body_b = {
        _FAL_IMG2IMG_RESPONSE_IMAGES_KEY: [
            {_FAL_IMG2IMG_RESPONSE_IMAGE_URL_KEY: "https://v3.fal.media/B"}
        ],
    }
    assert _parse_img2img_response(body_a) == "https://v3.fal.media/A"
    assert _parse_img2img_response(body_b) == "https://v3.fal.media/B"
    # And in reverse order — proves nothing was cached behind the scenes.
    assert _parse_img2img_response(body_a) == "https://v3.fal.media/A"
