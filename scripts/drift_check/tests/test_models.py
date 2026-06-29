import dataclasses
import pytest
from scripts.drift_check.models import Target, Marker, Finding


def test_models_are_frozen_dataclasses():
    t = Target(raw="CLAUDE.md", source_syntax="filename", canonical_path="CLAUDE.md", section_id=None)
    m = Marker(location="STRATEGY.md:28", keyword="SUPERSEDED", date="2026-06-28", raw_text="...", targets=(t,))
    f = Finding(marker_location="STRATEGY.md:28", target_raw="CLAUDE.md", target_path="CLAUDE.md",
                state="PROPAGATION_MISSING", evidence="no back-reference")
    # frozen → mutation raises
    with pytest.raises(dataclasses.FrozenInstanceError):
        t.raw = "x"  # type: ignore[misc]
    assert m.targets[0] is t
    assert f.state == "PROPAGATION_MISSING"
