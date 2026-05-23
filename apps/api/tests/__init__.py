"""Test suite for the apps/api FastAPI workspace.

Unit tier overrides Depends-injected callables via ``app.dependency_overrides``
so MediaPipe and Pillow are never loaded in fast unit tests. The integration
tier (``@pytest.mark.integration``) hits real Postgres + the real
``diagnose_personal_color`` pipeline.
"""
