"""TrendDrop domain value object (Sub-AC 3a / retention engine).

Seed ontology field: ``trend_drop``
-------------------------------------
  recipe_id, pushed_at, target_user_segment, restyle_cta.
  v1 = 본인 수동 push (반자동).

This module owns the immutable value object only — no HTTP, no DB, no
notification copy.  Notification copy lives in
:mod:`api.trend_drop.notification` so the two concerns stay separate and each
can be tested independently.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class TrendDrop:
    """Immutable trend-drop event descriptor.

    A ``TrendDrop`` carries the operator-curated metadata for a single trend
    event push. It is the *input* consumed by the notification copy functions;
    it does not itself produce any copy text (voice/tone is injected separately
    via :class:`~api.voice.config.VoiceConfig`).

    Attributes
    ----------
    recipe_id:
        Stable identifier for the generation recipe associated with this trend.
        Links the drop to its upstream prompt / style template.
    trend_name:
        Human-readable name for the trend (e.g. ``"Y2K 글리터"``, ``"하이틴 그라데이션"``).
        Included in notification copy.
    pushed_at:
        UTC timestamp of when the operator pushed this trend drop.
    target_user_segment:
        Identifier for the user segment receiving this drop (e.g. a
        personal-color category like ``"봄웜"`` or ``"all"`` for a broadcast).
    restyle_cta:
        The restyle call-to-action URL or deep link that the notification
        resolves to.  Used in the in-app alert body.
    """

    recipe_id: str
    trend_name: str
    pushed_at: datetime
    target_user_segment: str
    restyle_cta: str


__all__ = ["TrendDrop"]
