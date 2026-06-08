"""Pipeline timing instrumentation — stage latency logging (AC20).

Seed constraints honored here
------------------------------
- Each stage (raw generation, enhancer, reject_filter, user_pick_presentation)
  is timed independently.
- Total elapsed time is aggregated.
- p95 < 30 seconds target: tracking infrastructure provides the raw data.

Design
------
:class:`PipelineTiming` records a timing entry per stage, then computes
the aggregate elapsed time. Tests inject a clock function (``time_fn``)
to avoid real wall-clock dependency.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

# ---------------------------------------------------------------------------
# Stage names
# ---------------------------------------------------------------------------

STAGE_RAW_GENERATION = "raw_generation"
STAGE_ENHANCER = "enhancer"
STAGE_REJECT_FILTER = "reject_filter"
STAGE_USER_PICK_PRESENTATION = "user_pick_presentation"

ALL_STAGES = [
    STAGE_RAW_GENERATION,
    STAGE_ENHANCER,
    STAGE_REJECT_FILTER,
    STAGE_USER_PICK_PRESENTATION,
]


# ---------------------------------------------------------------------------
# Timing record
# ---------------------------------------------------------------------------


@dataclass
class StageTimingEntry:
    """Timing for a single pipeline stage.

    Attributes
    ----------
    stage:
        Stage name (e.g. STAGE_RAW_GENERATION).
    start_time:
        Start timestamp (seconds since epoch, from time_fn).
    end_time:
        End timestamp (None until :meth:`~PipelineTiming.end_stage` called).
    duration_seconds:
        Elapsed time in seconds (None until stage ends).
    """

    stage: str
    start_time: float
    end_time: float | None = None
    duration_seconds: float | None = None


@dataclass
class PipelineTiming:
    """Collects timing entries for all pipeline stages.

    Usage pattern::

        timing = PipelineTiming()
        timing.start_stage("raw_generation")
        # ... do raw generation ...
        timing.end_stage("raw_generation")
        ...
        summary = timing.total_elapsed_seconds()

    Attributes
    ----------
    entries:
        Ordered list of stage timing entries.
    """

    entries: list[StageTimingEntry] = field(default_factory=list)
    _time_fn: Callable[[], float] = field(default=None, repr=False)  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self._time_fn is None:
            import time

            self._time_fn = time.monotonic

    def start_stage(self, stage: str) -> None:
        """Record the start of a pipeline stage."""
        entry = StageTimingEntry(
            stage=stage,
            start_time=self._time_fn(),
        )
        self.entries.append(entry)

    def end_stage(self, stage: str) -> None:
        """Record the end of a pipeline stage.

        Raises
        ------
        ValueError
            If the stage was not started or was already ended.
        """
        for entry in reversed(self.entries):
            if entry.stage == stage and entry.end_time is None:
                entry.end_time = self._time_fn()
                entry.duration_seconds = entry.end_time - entry.start_time
                return
        raise ValueError(f"Stage {stage!r} was not started or was already ended.")

    def get_stage_duration(self, stage: str) -> float | None:
        """Return duration_seconds for the most recent completed entry of a stage."""
        for entry in reversed(self.entries):
            if entry.stage == stage and entry.duration_seconds is not None:
                return entry.duration_seconds
        return None

    def total_elapsed_seconds(self) -> float:
        """Compute total elapsed time across all completed stages.

        Returns the sum of all completed stage durations.
        """
        return sum(
            e.duration_seconds for e in self.entries if e.duration_seconds is not None
        )

    def all_stages_logged(self) -> bool:
        """Return True if all 4 standard stages have a completed entry."""
        completed_stages = {
            e.stage for e in self.entries if e.duration_seconds is not None
        }
        return all(s in completed_stages for s in ALL_STAGES)

    def as_dict(self) -> dict[str, float | None]:
        """Return per-stage durations as a dict for logging."""
        result: dict[str, float | None] = {}
        for entry in self.entries:
            result[entry.stage] = entry.duration_seconds
        return result


# ---------------------------------------------------------------------------
# Factory function
# ---------------------------------------------------------------------------


def create_pipeline_timing(
    time_fn: Callable[[], float] | None = None,
) -> PipelineTiming:
    """Create a PipelineTiming with optional injected clock function.

    Parameters
    ----------
    time_fn:
        Clock callable returning current time in seconds.
        Defaults to ``time.monotonic`` if None.
    """
    timing = PipelineTiming()
    if time_fn is not None:
        timing._time_fn = time_fn
    return timing


__all__ = [
    "STAGE_RAW_GENERATION",
    "STAGE_ENHANCER",
    "STAGE_REJECT_FILTER",
    "STAGE_USER_PICK_PRESENTATION",
    "ALL_STAGES",
    "StageTimingEntry",
    "PipelineTiming",
    "create_pipeline_timing",
]
