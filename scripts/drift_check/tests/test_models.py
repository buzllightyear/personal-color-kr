import dataclasses
import pytest
from scripts.drift_check.models import (
    Target,
    Marker,
    Finding,
    SeamSource,
    ConfigSeam,
    ConfigFinding,
)


def test_models_are_frozen_dataclasses():
    t = Target(
        raw="CLAUDE.md",
        source_syntax="filename",
        canonical_path="CLAUDE.md",
        section_id=None,
    )
    m = Marker(
        location="STRATEGY.md:28",
        keyword="SUPERSEDED",
        date="2026-06-28",
        raw_text="...",
        targets=(t,),
    )
    f = Finding(
        marker_location="STRATEGY.md:28",
        target_raw="CLAUDE.md",
        target_path="CLAUDE.md",
        state="PROPAGATION_MISSING",
        evidence="no back-reference",
    )
    # frozen → mutation raises
    with pytest.raises(dataclasses.FrozenInstanceError):
        t.raw = "x"  # type: ignore[misc]
    assert m.targets[0] is t
    assert f.state == "PROPAGATION_MISSING"


def test_seam_source_is_frozen():
    s = SeamSource(file=".github/workflows/ci.yml", kind="yaml-regex")
    assert s.group is None
    with pytest.raises(dataclasses.FrozenInstanceError):
        s.file = "x"  # frozen → FrozenInstanceError


def test_config_seam_holds_two_sources():
    seam = ConfigSeam(
        name="pytest-version-pin",
        package="pytest",
        source_a=SeamSource(file="a", kind="yaml-regex"),
        source_b=SeamSource(file="b", kind="toml-dep-group", group="dev"),
    )
    assert seam.package == "pytest"
    assert seam.source_b.group == "dev"


def test_config_finding_fields():
    f = ConfigFinding(
        seam_name="pytest-version-pin",
        value_a="<9.1",
        value_b=">=9.1.1",
        state="CONFIG_SEAM_MISMATCH",
        evidence="ev",
    )
    assert f.state == "CONFIG_SEAM_MISMATCH"
    assert (f.value_a, f.value_b) == ("<9.1", ">=9.1.1")
