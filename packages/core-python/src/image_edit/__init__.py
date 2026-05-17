"""Image-edit subsystem (AC 9).

This package wraps commoditised generative-AI image-editing vendors
(Nano Banana / Replicate / MediaPipe / Face++) per the Seed Contract.
The product itself never trains models — it only orchestrates vendor
calls behind a stable in-process interface.

Public surface (Sub-AC 9.1):
    - `edit_image`              : main wrapper function
    - `VendorRequest`           : input dataclass (image bytes + params)
    - `VendorResponse`          : output dataclass (edited image + metadata)
    - `VendorCaller`            : Protocol every concrete vendor adapter
                                  must satisfy
    - `VendorError`             : transient or permanent vendor failure
    - `VendorTimeoutError`      : raised when timeout budget is exhausted

Public surface (Sub-AC 9.2):
    - `LatencyTracker`          : thread-safe latency-sample accumulator
    - `LatencyStats`             : frozen snapshot with p50/p95/p99
    - `track_latency`           : decorator that records call duration
    - `measure_latency`         : context-manager equivalent

Public surface (Sub-AC 9.3):
    - `run_edit_pipeline`       : end-to-end selfie → edited result
                                  pipeline combining vendor_client and
                                  latency_tracker
    - `PipelineResult`          : frozen dataclass returned by the
                                  pipeline (edited bytes + end-to-end
                                  latency + underlying vendor response)
    - `P95_SLO_SECONDS`         : the Seed Contract's 30s p95 SLO
                                  target, surfaced as a module-level
                                  constant so callers, tests, and
                                  dashboards reference the same number
"""

from __future__ import annotations

from .latency_tracker import (
    LatencyStats,
    LatencyTracker,
    measure_latency,
    track_latency,
)
from .pipeline import (
    P95_SLO_SECONDS,
    PipelineResult,
    run_edit_pipeline,
)
from .vendor_client import (
    DEFAULT_MAX_RETRIES,
    DEFAULT_TIMEOUT_SECONDS,
    VendorCaller,
    VendorError,
    VendorRequest,
    VendorResponse,
    VendorTimeoutError,
    edit_image,
)

__all__ = [
    "DEFAULT_MAX_RETRIES",
    "DEFAULT_TIMEOUT_SECONDS",
    "LatencyStats",
    "LatencyTracker",
    "P95_SLO_SECONDS",
    "PipelineResult",
    "VendorCaller",
    "VendorError",
    "VendorRequest",
    "VendorResponse",
    "VendorTimeoutError",
    "edit_image",
    "measure_latency",
    "run_edit_pipeline",
    "track_latency",
]
