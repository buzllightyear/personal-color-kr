"""Fast unit tests for ``apps/api`` (no Postgres, no MediaPipe, no Pillow).

Tests in this tier override ``app.dependency_overrides`` so external
dependencies (real DB, real diagnose pipeline) are never loaded. They run
under ``pytest -m 'not integration'`` and form the always-on tier of the
``four_way_consistency`` quartet (pytest + mypy --strict + ruff + black).
"""
