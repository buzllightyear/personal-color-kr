"""personal_color.generate — fal.ai generation client, watermark compositing, and rejection scorer.

Exports:
    FalGenerationConfig: Frozen dataclass carrying the recipe-derived
        parameters needed for a single fal.ai generation call.
    FalGenerationError: Exception raised on fal.ai call failures.
    generate_from_recipe: Generate an image from a recipe config and selfie bytes.
    DEFAULT_WATERMARK_TEXT: Default brand attribution string used by the watermark.
    apply_watermark: Composite a text watermark onto image bytes and return PNG bytes.
    RejectionVerdict: Structured NSFW/artifact rejection verdict.
    NsfwClassifier: Protocol for injectable NSFW classifiers.
    StubNsfwClassifier: Fixed-score stub for tests / local development.
    FalNsfwClassifier: Production NSFW classifier using fal.ai endpoint.
    NsfwClassificationError: Exception raised on NSFW classification failures.
    score_image: Score a candidate image for NSFW content and severe artifacts.
    DEFAULT_NSFW_THRESHOLD: Default NSFW rejection threshold (0.1).
    DEFAULT_ARTIFACT_THRESHOLD: Default artifact rejection threshold (0.9).
"""

from .fal_client import (
    FalGenerationConfig,
    FalGenerationError,
    generate_from_recipe,
)
from .rejection import (
    DEFAULT_ARTIFACT_THRESHOLD,
    DEFAULT_NSFW_THRESHOLD,
    FalNsfwClassifier,
    NsfwClassificationError,
    NsfwClassifier,
    RejectionVerdict,
    StubNsfwClassifier,
    score_image,
)
from .watermark import (
    DEFAULT_WATERMARK_TEXT,
    apply_watermark,
)

__all__ = [
    "FalGenerationConfig",
    "FalGenerationError",
    "generate_from_recipe",
    "DEFAULT_WATERMARK_TEXT",
    "apply_watermark",
    "RejectionVerdict",
    "NsfwClassifier",
    "StubNsfwClassifier",
    "FalNsfwClassifier",
    "NsfwClassificationError",
    "score_image",
    "DEFAULT_NSFW_THRESHOLD",
    "DEFAULT_ARTIFACT_THRESHOLD",
]
