"""Integration tests for `build_post_payment_package` (Sub-AC 5.2).

This suite exercises the *composition* of the four post-payment
primitives — diagnosis orchestrator, image-edit pipeline, guides
loader, and curations loader — into a single coherent `ContentPackage`.

Why an integration suite rather than a unit suite:

  - Each primitive already has its own unit-suite coverage. The point
    here is to prove the wiring: that the diagnosis season really does
    drive the guide + curation selection, that the vendor's bytes
    actually arrive on the package, and that all four 봄/여름/가을/겨울
    archetypes produce coherent bundles end-to-end.

  - The vendor is mocked throughout (per Seed Contract — never hit a
    real vendor in CI). The mock satisfies the `VendorCaller` protocol
    and lets the suite assert plumbing-level facts (request bytes,
    requested params, requested vendor) without burning a real RPC.

Coverage matrix:

  Happy path — coherent bundles for every season
    - test_build_returns_coherent_package_for_every_season
    - test_build_routes_vendor_payload_into_package
    - test_build_records_vendor_params_and_vendor_hint
    - test_build_records_latency_into_supplied_tracker

  Composition wiring
    - test_build_pipeline_runs_after_diagnosis
    - test_build_loads_guides_and_curation_for_diagnosed_season
    - test_build_returns_frozen_hashable_package

  Failure propagation
    - test_build_propagates_vendor_error
    - test_build_propagates_bad_region_colors

Marker: every test is `@pytest.mark.integration` — these tests cross
module boundaries (content + image_edit + personal_color) by design.
"""

from __future__ import annotations

import dataclasses

import pytest

from content.curations import (
    FirstCuration,
    load_first_curation_for_season,
)
from content.guides import Guide, load_guides_for_season
from content.post_payment_package import ContentPackage
from content.post_payment_package_builder import build_post_payment_package
from image_edit.latency_tracker import LatencyTracker
from image_edit.vendor_client import VendorError, VendorRequest
from personal_color.diagnosis_orchestrator import DiagnosisResult
from personal_color.region_extractor import RegionColors
from personal_color.season_classifier import Season


# ---------------------------------------------------------------------------
# Fixtures — one RegionColors archetype per season. The diagnosis
# orchestrator's own test suite already pins these archetypes to the
# expected seasons; we re-use them here so the integration suite uses
# the same trusted inputs.
# ---------------------------------------------------------------------------


_SAMPLE_SELFIE: bytes = b"\x89PNG\r\n\x1a\n" + b"integration-selfie-payload" * 4


_REGION_COLORS_BY_SEASON: dict[Season, RegionColors] = {
    # Warm undertone, bright skin vs dark hair → HIGH contrast → 봄.
    Season.SPRING: RegionColors(
        skin=(230, 195, 160),
        eyes=(80, 50, 30),
        hair=(70, 45, 30),
    ),
    # Cool undertone, small luma gap → LOW contrast → 여름.
    Season.SUMMER: RegionColors(
        skin=(210, 200, 215),
        eyes=(90, 80, 95),
        hair=(150, 140, 160),
    ),
    # Warm undertone, small luma gap → LOW contrast → 가을.
    Season.AUTUMN: RegionColors(
        skin=(170, 130, 95),
        eyes=(95, 70, 50),
        hair=(140, 105, 80),
    ),
    # Cool undertone, large luma gap → HIGH contrast → 겨울.
    Season.WINTER: RegionColors(
        skin=(210, 215, 235),
        eyes=(40, 35, 50),
        hair=(20, 18, 25),
    ),
}


# ---------------------------------------------------------------------------
# Vendor mocks. Mirrors the deterministic stubs from
# `tests/image_edit/test_pipeline.py` so the SLO and retry semantics
# the pipeline already enforces are preserved unchanged here.
# ---------------------------------------------------------------------------


def _recording_vendor(payload: bytes = b"edited-jpeg-bytes"):
    """Vendor stub that returns `payload` and records every call it sees.

    The returned `_caller` has a `.calls` list attribute the tests can
    inspect to assert the assembler routed `selfie_bytes`, `params`, and
    the `vendor` hint into the vendor request faithfully.
    """

    calls: list[tuple[VendorRequest, float]] = []

    def _caller(request: VendorRequest, attempt_timeout: float) -> bytes:
        calls.append((request, attempt_timeout))
        return payload

    _caller.calls = calls  # type: ignore[attr-defined]
    return _caller


def _failing_vendor():
    """Vendor stub that always raises `VendorError` (terminal failure)."""

    def _caller(request: VendorRequest, attempt_timeout: float) -> bytes:
        raise VendorError("persistent vendor 5xx in integration test")

    return _caller


def _noop_sleep(seconds: float) -> None:
    """Recording-free sleep stub — the integration suite never waits."""
    return None


# ---------------------------------------------------------------------------
# Happy path — coherent bundles for every season
# ---------------------------------------------------------------------------


@pytest.mark.integration
@pytest.mark.parametrize("season", list(Season))
def test_build_returns_coherent_package_for_every_season(season: Season) -> None:
    """All 4 봄/여름/가을/겨울 archetypes assemble into valid packages.

    The diagnosis season must drive both the guides and the curation —
    if the assembler hard-coded a default season, three of these four
    parametrized runs would fail.
    """
    vendor = _recording_vendor(b"edited-for-" + season.name.lower().encode())

    package = build_post_payment_package(
        selfie_bytes=_SAMPLE_SELFIE,
        region_colors=_REGION_COLORS_BY_SEASON[season],
        vendor_caller=vendor,
        sleep=_noop_sleep,
    )

    assert isinstance(package, ContentPackage)
    assert package.diagnosis.season is season
    assert all(g.season is season for g in package.guides)
    assert package.curations.season is season


@pytest.mark.integration
def test_build_routes_vendor_payload_into_package() -> None:
    """The vendor's edited bytes must arrive verbatim on the package."""
    payload = b"banana-edit-payload-001"
    vendor = _recording_vendor(payload)

    package = build_post_payment_package(
        selfie_bytes=_SAMPLE_SELFIE,
        region_colors=_REGION_COLORS_BY_SEASON[Season.SPRING],
        vendor_caller=vendor,
        sleep=_noop_sleep,
    )

    assert package.edited_image.edited_bytes == payload
    assert package.edited_image.vendor == "nano_banana"
    assert package.edited_image.pipeline_latency_seconds >= 0


@pytest.mark.integration
def test_build_records_vendor_params_and_vendor_hint() -> None:
    """`params` and `vendor` are forwarded into the underlying VendorRequest."""
    vendor = _recording_vendor()
    custom_params = {"preset": "spring_warm", "intensity": 0.7}

    build_post_payment_package(
        selfie_bytes=_SAMPLE_SELFIE,
        region_colors=_REGION_COLORS_BY_SEASON[Season.SPRING],
        vendor_caller=vendor,
        params=custom_params,
        vendor="replicate",
        sleep=_noop_sleep,
    )

    assert len(vendor.calls) == 1  # type: ignore[attr-defined]
    request, _ = vendor.calls[0]  # type: ignore[attr-defined]
    assert request.selfie_bytes == _SAMPLE_SELFIE
    assert request.vendor == "replicate"
    # VendorRequest snapshots `params` into an immutable dict on
    # construction — comparing by value is the right invariant.
    assert dict(request.params) == custom_params


@pytest.mark.integration
def test_build_records_latency_into_supplied_tracker() -> None:
    """One latency sample per build call — SLO dashboards depend on this."""
    tracker = LatencyTracker()
    vendor = _recording_vendor()

    build_post_payment_package(
        selfie_bytes=_SAMPLE_SELFIE,
        region_colors=_REGION_COLORS_BY_SEASON[Season.WINTER],
        vendor_caller=vendor,
        tracker=tracker,
        sleep=_noop_sleep,
    )

    snapshot = tracker.snapshot()
    assert snapshot.count == 1


# ---------------------------------------------------------------------------
# Composition wiring
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_build_pipeline_runs_after_diagnosis() -> None:
    """A malformed RegionColors must fail before the vendor is ever called.

    The assembler runs the diagnosis (cheap, in-process) first so bad
    inputs don't burn a vendor RPC. We verify that by passing a
    non-RegionColors and asserting the recording vendor saw zero calls.
    """
    vendor = _recording_vendor()

    with pytest.raises(TypeError, match="colors must be a RegionColors"):
        build_post_payment_package(
            selfie_bytes=_SAMPLE_SELFIE,
            region_colors="not-a-region-colors",  # type: ignore[arg-type]
            vendor_caller=vendor,
            sleep=_noop_sleep,
        )

    assert vendor.calls == []  # type: ignore[attr-defined]


@pytest.mark.integration
@pytest.mark.parametrize("season", list(Season))
def test_build_loads_guides_and_curation_for_diagnosed_season(
    season: Season,
) -> None:
    """The bundled guides/curation must be the canonical loader output."""
    vendor = _recording_vendor()

    package = build_post_payment_package(
        selfie_bytes=_SAMPLE_SELFIE,
        region_colors=_REGION_COLORS_BY_SEASON[season],
        vendor_caller=vendor,
        sleep=_noop_sleep,
    )

    # Equality (not identity) — `load_guides_for_season` filters the
    # catalogue and returns a fresh tuple each call, while
    # `load_first_curation_for_season` returns the same FirstCuration
    # constant. Either way the assembler must not re-wrap or transform
    # them.
    expected_guides = load_guides_for_season(season)
    expected_curation = load_first_curation_for_season(season)
    assert package.guides == expected_guides
    assert package.curations is expected_curation

    # Defensive shape checks — guard against a future refactor that
    # silently changes the loader contract.
    assert isinstance(package.guides, tuple)
    assert all(isinstance(g, Guide) for g in package.guides)
    assert isinstance(package.curations, FirstCuration)
    assert isinstance(package.diagnosis, DiagnosisResult)


@pytest.mark.integration
def test_build_returns_frozen_hashable_package() -> None:
    """`ContentPackage` is frozen + hashable — analytics relies on both."""
    vendor = _recording_vendor()

    package = build_post_payment_package(
        selfie_bytes=_SAMPLE_SELFIE,
        region_colors=_REGION_COLORS_BY_SEASON[Season.AUTUMN],
        vendor_caller=vendor,
        sleep=_noop_sleep,
    )

    # Frozen.
    with pytest.raises(dataclasses.FrozenInstanceError):
        package.diagnosis = package.diagnosis  # type: ignore[misc]

    # Hashable — must not raise.
    hash(package)


# ---------------------------------------------------------------------------
# Failure propagation
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_build_propagates_vendor_error() -> None:
    """A persistent vendor failure surfaces as `VendorError` to the caller."""
    with pytest.raises(VendorError, match="persistent vendor 5xx"):
        build_post_payment_package(
            selfie_bytes=_SAMPLE_SELFIE,
            region_colors=_REGION_COLORS_BY_SEASON[Season.SPRING],
            vendor_caller=_failing_vendor(),
            sleep=_noop_sleep,
        )


@pytest.mark.integration
def test_build_propagates_bad_region_colors() -> None:
    """Wrong-type `region_colors` surfaces a `TypeError` from the orchestrator."""
    vendor = _recording_vendor()
    with pytest.raises(TypeError, match="colors must be a RegionColors"):
        build_post_payment_package(
            selfie_bytes=_SAMPLE_SELFIE,
            region_colors={"skin": (1, 2, 3)},  # type: ignore[arg-type]
            vendor_caller=vendor,
            sleep=_noop_sleep,
        )
