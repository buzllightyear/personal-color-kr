"""Unit tests for POST /v1/admin/recipes/{recipe_id}/preview (Sub-AC 5.2).

Acceptance criterion verified
------------------------------
Sub-AC 2: fal.ai preview pipeline integration.

* The endpoint reads a recipe record from the DB.
* Constructs the fal.ai payload (model_id, prompt, style-reference,
  parameters) and calls the fal.ai client.
* Returns the resulting image URL on success.
* Surfaces a structured error on fal.ai failure.

All tests monkey-patch the fal.ai client so no real HTTP call is made.
A separate optional ``@pytest.mark.integration`` marker in
:mod:`test_admin_recipe_preview_live` (not this file) covers real fal.ai
calls when the ``FAL_LIVE`` env var is set.

Test strategy
-------------
Every test:

1. Creates a minimal in-memory ``Recipe`` ORM object.
2. Overrides the ``get_session`` DB dependency with a stub that returns
   that recipe (or raises ``recipe_not_found``).
3. Overrides the ``require_admin`` dependency to bypass auth.
4. Monkey-patches ``call_fal_recipe_preview`` in the router module so
   no real HTTP call is attempted.
5. Asserts on the HTTP response status and JSON body.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.models.recipe import RECIPE_STATUS_PUBLISHED, Recipe
from api.dependencies.admin_auth import require_admin
from api.generation.fal_preview_caller import FalPreviewError
from api.main import create_app

# ---------------------------------------------------------------------------
# Test fixtures
# ---------------------------------------------------------------------------


def _make_recipe(
    recipe_id: str = "test-recipe-v1",
    model_id: str = "fal-ai/flux/dev",
    prompt_template: str = "A beautiful portrait with {personal_color} tones",
    style_reference_key: str | None = None,
    parameters: dict[str, Any] | None = None,
    recipe_status: str = RECIPE_STATUS_PUBLISHED,
) -> Recipe:
    """Return a minimal in-memory Recipe ORM object (no DB round-trip)."""
    now = datetime.now(timezone.utc)
    recipe = Recipe()
    recipe.id = uuid.uuid4()
    recipe.recipe_id = recipe_id
    recipe.model_id = model_id
    recipe.prompt_template = prompt_template
    recipe.style_reference_key = style_reference_key
    recipe.parameters = parameters or {}
    recipe.status = recipe_status
    recipe.publish_date = now
    recipe.display_order = 0
    recipe.created_at = now
    recipe.updated_at = now
    return recipe


def _make_mock_session(recipe: Recipe | None) -> Any:
    """Return an async session stub that returns ``recipe`` or raises 404.

    When ``recipe`` is ``None``, the scalar_one_or_none call returns None,
    which triggers the router's 404 logic.
    """
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = recipe

    mock_session = AsyncMock(spec=AsyncSession)
    mock_session.execute = AsyncMock(return_value=mock_result)
    return mock_session


def _stub_require_admin() -> None:
    """No-op replacement for the admin auth dependency."""
    return None


def _make_app_with_overrides(session_stub: Any) -> FastAPI:
    """Build a fresh app with session + admin-auth dependencies overridden."""
    from api.db.session import get_session

    app = create_app()
    app.dependency_overrides[get_session] = lambda: session_stub
    app.dependency_overrides[require_admin] = _stub_require_admin
    return app


# ---------------------------------------------------------------------------
# Happy-path: successful fal.ai call
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_preview_returns_image_url_on_success() -> None:
    """A successful fal.ai call returns 200 with the image URL."""
    recipe = _make_recipe()
    session = _make_mock_session(recipe)
    app = _make_app_with_overrides(session)

    mock_image_url = "https://fal.media/files/abc123/generated.webp"

    with (
        patch(
            "api.routers.admin_recipes.call_fal_recipe_preview",
            return_value=mock_image_url,
        ),
        patch(
            "api.routers.admin_recipes.load_fal_api_key",
            return_value="test-key-id:test-key-secret",
            create=True,
        ),
        patch(
            "image_edit.fal_ai_api_key.load_fal_api_key",
            return_value="test-key-id:test-key-secret",
        ),
    ):
        with TestClient(app) as client:
            response = client.post(
                "/v1/admin/recipes/test-recipe-v1/preview",
                headers={"Authorization": "Bearer dummy-token"},
            )

    assert response.status_code == 200
    data = response.json()
    assert "image_url" in data
    assert data["image_url"] == mock_image_url


@pytest.mark.unit
def test_preview_passes_model_id_and_prompt_to_fal_caller() -> None:
    """The preview endpoint forwards model_id and prompt_template to the caller."""
    recipe = _make_recipe(
        model_id="fal-ai/flux-realism",
        prompt_template="Cinematic portrait with warm tones",
        parameters={"num_inference_steps": 30},
    )
    session = _make_mock_session(recipe)
    app = _make_app_with_overrides(session)

    captured_kwargs: dict[str, Any] = {}

    def _capture(**kwargs: Any) -> str:
        captured_kwargs.update(kwargs)
        return "https://fal.media/files/captured.webp"

    with (
        patch(
            "api.routers.admin_recipes.call_fal_recipe_preview",
            side_effect=_capture,
        ),
        patch(
            "image_edit.fal_ai_api_key.load_fal_api_key",
            return_value="test-key",
        ),
    ):
        with TestClient(app) as client:
            client.post(
                "/v1/admin/recipes/test-recipe-v1/preview",
                headers={"Authorization": "Bearer dummy-token"},
            )

    assert captured_kwargs.get("model_id") == "fal-ai/flux-realism"
    assert captured_kwargs.get("prompt") == "Cinematic portrait with warm tones"
    assert captured_kwargs.get("parameters") == {"num_inference_steps": 30}


@pytest.mark.unit
def test_preview_passes_style_reference_url_when_https() -> None:
    """style_reference_key that is an HTTPS URL is forwarded to the caller."""
    recipe = _make_recipe(
        style_reference_key="https://cdn.example.com/style-ref.jpg",
    )
    session = _make_mock_session(recipe)
    app = _make_app_with_overrides(session)

    captured_style: list[str | None] = []

    def _capture(**kwargs: Any) -> str:
        captured_style.append(kwargs.get("style_reference_url"))
        return "https://fal.media/files/styled.webp"

    with (
        patch(
            "api.routers.admin_recipes.call_fal_recipe_preview",
            side_effect=_capture,
        ),
        patch(
            "image_edit.fal_ai_api_key.load_fal_api_key",
            return_value="test-key",
        ),
    ):
        with TestClient(app) as client:
            client.post(
                "/v1/admin/recipes/test-recipe-v1/preview",
                headers={"Authorization": "Bearer dummy-token"},
            )

    assert captured_style == ["https://cdn.example.com/style-ref.jpg"]


@pytest.mark.unit
def test_preview_omits_style_reference_for_non_url_key() -> None:
    """style_reference_key that is a storage key (not URL) is NOT forwarded."""
    recipe = _make_recipe(
        style_reference_key="r2/recipes/style-ref-aurora.jpg",
    )
    session = _make_mock_session(recipe)
    app = _make_app_with_overrides(session)

    captured_style: list[str | None] = []

    def _capture(**kwargs: Any) -> str:
        captured_style.append(kwargs.get("style_reference_url"))
        return "https://fal.media/files/no-style.webp"

    with (
        patch(
            "api.routers.admin_recipes.call_fal_recipe_preview",
            side_effect=_capture,
        ),
        patch(
            "image_edit.fal_ai_api_key.load_fal_api_key",
            return_value="test-key",
        ),
    ):
        with TestClient(app) as client:
            client.post(
                "/v1/admin/recipes/test-recipe-v1/preview",
                headers={"Authorization": "Bearer dummy-token"},
            )

    # Storage key is not an HTTP URL → style_reference_url must be None
    assert captured_style == [None]


# ---------------------------------------------------------------------------
# Error cases
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_preview_returns_404_when_recipe_not_found() -> None:
    """Returns 404 with recipe_not_found detail when recipe does not exist."""
    session = _make_mock_session(recipe=None)
    app = _make_app_with_overrides(session)

    with TestClient(app) as client:
        response = client.post(
            "/v1/admin/recipes/no-such-recipe/preview",
            headers={"Authorization": "Bearer dummy-token"},
        )

    assert response.status_code == 404
    assert response.json()["detail"] == "recipe_not_found"


@pytest.mark.unit
def test_preview_returns_503_when_fal_key_not_configured() -> None:
    """Returns 503 fal_key_not_configured when the API key is missing."""
    recipe = _make_recipe()
    session = _make_mock_session(recipe)
    app = _make_app_with_overrides(session)

    with patch(
        "image_edit.fal_ai_api_key.load_fal_api_key",
        side_effect=LookupError("FAL_API_KEY is not set"),
    ):
        with TestClient(app) as client:
            response = client.post(
                "/v1/admin/recipes/test-recipe-v1/preview",
                headers={"Authorization": "Bearer dummy-token"},
            )

    assert response.status_code == 503
    detail = response.json()["detail"]
    assert detail["error"] == "fal_key_not_configured"


@pytest.mark.unit
def test_preview_returns_502_on_retryable_fal_error() -> None:
    """Returns 502 fal_server_error on transient fal.ai failure."""
    recipe = _make_recipe()
    session = _make_mock_session(recipe)
    app = _make_app_with_overrides(session)

    with (
        patch(
            "api.routers.admin_recipes.call_fal_recipe_preview",
            side_effect=FalPreviewError(
                "fal preview: transient HTTP 503",
                status_code=503,
                retryable=True,
            ),
        ),
        patch(
            "image_edit.fal_ai_api_key.load_fal_api_key",
            return_value="test-key",
        ),
    ):
        with TestClient(app) as client:
            response = client.post(
                "/v1/admin/recipes/test-recipe-v1/preview",
                headers={"Authorization": "Bearer dummy-token"},
            )

    assert response.status_code == 502
    detail = response.json()["detail"]
    assert detail["error"] == "fal_server_error"
    assert "message" in detail


@pytest.mark.unit
def test_preview_returns_422_on_permanent_fal_error() -> None:
    """Returns 422 fal_client_error on permanent fal.ai failure (e.g. 400)."""
    recipe = _make_recipe()
    session = _make_mock_session(recipe)
    app = _make_app_with_overrides(session)

    with (
        patch(
            "api.routers.admin_recipes.call_fal_recipe_preview",
            side_effect=FalPreviewError(
                "fal preview: client error HTTP 400",
                status_code=400,
                retryable=False,
            ),
        ),
        patch(
            "image_edit.fal_ai_api_key.load_fal_api_key",
            return_value="test-key",
        ),
    ):
        with TestClient(app) as client:
            response = client.post(
                "/v1/admin/recipes/test-recipe-v1/preview",
                headers={"Authorization": "Bearer dummy-token"},
            )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["error"] == "fal_client_error"
    assert "message" in detail


# ---------------------------------------------------------------------------
# Unit tests for fal_preview_caller pure functions
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_parse_fal_response_returns_first_image_url() -> None:
    """_parse_fal_response extracts images[0].url from a valid response."""
    from api.generation.fal_preview_caller import _parse_fal_response

    body = {
        "images": [
            {"url": "https://cdn.fal.ai/output.webp", "width": 1024, "height": 1024}
        ],
        "seed": 42,
        "prompt": "...",
    }

    result = _parse_fal_response(body)

    assert result == "https://cdn.fal.ai/output.webp"


@pytest.mark.unit
def test_parse_fal_response_raises_on_non_dict_body() -> None:
    """_parse_fal_response raises FalPreviewError when body is not a dict."""
    from api.generation.fal_preview_caller import _parse_fal_response

    with pytest.raises(FalPreviewError, match="was not a JSON object"):
        _parse_fal_response(["list", "body"])


@pytest.mark.unit
def test_parse_fal_response_raises_on_empty_images() -> None:
    """_parse_fal_response raises FalPreviewError when images array is empty."""
    from api.generation.fal_preview_caller import _parse_fal_response

    with pytest.raises(FalPreviewError, match="images"):
        _parse_fal_response({"images": []})


@pytest.mark.unit
def test_parse_fal_response_raises_on_missing_images_key() -> None:
    """_parse_fal_response raises FalPreviewError when 'images' key is absent."""
    from api.generation.fal_preview_caller import _parse_fal_response

    with pytest.raises(FalPreviewError, match="images"):
        _parse_fal_response({"seed": 42})


@pytest.mark.unit
def test_parse_fal_response_raises_on_non_dict_image_entry() -> None:
    """_parse_fal_response raises FalPreviewError when images[0] is not a dict."""
    from api.generation.fal_preview_caller import _parse_fal_response

    with pytest.raises(FalPreviewError, match="images"):
        _parse_fal_response({"images": ["not-a-dict"]})


@pytest.mark.unit
def test_parse_fal_response_raises_on_empty_url() -> None:
    """_parse_fal_response raises FalPreviewError when url is empty string."""
    from api.generation.fal_preview_caller import _parse_fal_response

    with pytest.raises(FalPreviewError, match="url"):
        _parse_fal_response({"images": [{"url": ""}]})


@pytest.mark.unit
def test_parse_fal_response_raises_on_missing_url_key() -> None:
    """_parse_fal_response raises FalPreviewError when 'url' key is absent."""
    from api.generation.fal_preview_caller import _parse_fal_response

    with pytest.raises(FalPreviewError, match="url"):
        _parse_fal_response({"images": [{"width": 1024}]})


# ---------------------------------------------------------------------------
# Unit tests for call_fal_recipe_preview with httpx mocked
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_call_fal_recipe_preview_success() -> None:
    """call_fal_recipe_preview returns image URL on 200 response."""
    from unittest.mock import MagicMock, patch

    from api.generation.fal_preview_caller import call_fal_recipe_preview

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "images": [{"url": "https://cdn.fal.ai/result.webp"}]
    }

    with patch("httpx.Client") as mock_client_cls:
        mock_client = MagicMock()
        mock_client_cls.return_value.__enter__.return_value = mock_client
        mock_client.post.return_value = mock_response

        result = call_fal_recipe_preview(
            model_id="fal-ai/flux/dev",
            prompt="test prompt",
            api_key="test-key-id:test-key-secret",
        )

    assert result == "https://cdn.fal.ai/result.webp"


@pytest.mark.unit
def test_call_fal_recipe_preview_builds_correct_endpoint() -> None:
    """call_fal_recipe_preview POSTs to https://fal.run/{model_id}."""
    from unittest.mock import MagicMock, patch

    from api.generation.fal_preview_caller import call_fal_recipe_preview

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "images": [{"url": "https://cdn.fal.ai/result.webp"}]
    }

    with patch("httpx.Client") as mock_client_cls:
        mock_client = MagicMock()
        mock_client_cls.return_value.__enter__.return_value = mock_client
        mock_client.post.return_value = mock_response

        call_fal_recipe_preview(
            model_id="fal-ai/flux-realism",
            prompt="test",
            api_key="k",
        )

        # Verify endpoint construction
        assert mock_client.post.call_count == 1
        call_args = mock_client.post.call_args
        assert call_args[0][0] == "https://fal.run/fal-ai/flux-realism"


@pytest.mark.unit
def test_call_fal_recipe_preview_raises_on_transient_error() -> None:
    """call_fal_recipe_preview raises FalPreviewError(retryable=True) on 503."""
    from unittest.mock import MagicMock, patch

    from api.generation.fal_preview_caller import (
        FalPreviewError,
        call_fal_recipe_preview,
    )

    mock_response = MagicMock()
    mock_response.status_code = 503

    with patch("httpx.Client") as mock_client_cls:
        mock_client = MagicMock()
        mock_client_cls.return_value.__enter__.return_value = mock_client
        mock_client.post.return_value = mock_response

        with pytest.raises(FalPreviewError) as exc_info:
            call_fal_recipe_preview(
                model_id="fal-ai/flux/dev",
                prompt="test",
                api_key="k",
            )

    assert exc_info.value.retryable is True
    assert exc_info.value.status_code == 503


@pytest.mark.unit
def test_call_fal_recipe_preview_raises_on_client_error() -> None:
    """call_fal_recipe_preview raises FalPreviewError(retryable=False) on 400."""
    from unittest.mock import MagicMock, patch

    from api.generation.fal_preview_caller import (
        FalPreviewError,
        call_fal_recipe_preview,
    )

    mock_response = MagicMock()
    mock_response.status_code = 400

    with patch("httpx.Client") as mock_client_cls:
        mock_client = MagicMock()
        mock_client_cls.return_value.__enter__.return_value = mock_client
        mock_client.post.return_value = mock_response

        with pytest.raises(FalPreviewError) as exc_info:
            call_fal_recipe_preview(
                model_id="fal-ai/flux/dev",
                prompt="test",
                api_key="k",
            )

    assert exc_info.value.retryable is False
    assert exc_info.value.status_code == 400


@pytest.mark.unit
def test_call_fal_recipe_preview_raises_on_timeout() -> None:
    """call_fal_recipe_preview raises FalPreviewError(retryable=True) on timeout."""
    from unittest.mock import MagicMock, patch

    import httpx as httpx_module

    from api.generation.fal_preview_caller import (
        FalPreviewError,
        call_fal_recipe_preview,
    )

    with patch("httpx.Client") as mock_client_cls:
        mock_client = MagicMock()
        mock_client_cls.return_value.__enter__.return_value = mock_client
        mock_client.post.side_effect = httpx_module.TimeoutException("timeout")

        with pytest.raises(FalPreviewError) as exc_info:
            call_fal_recipe_preview(
                model_id="fal-ai/flux/dev",
                prompt="test",
                api_key="k",
            )

    assert exc_info.value.retryable is True
    assert exc_info.value.status_code is None


@pytest.mark.unit
def test_call_fal_recipe_preview_includes_parameters_in_payload() -> None:
    """call_fal_recipe_preview merges parameters dict into the POST payload."""
    from unittest.mock import MagicMock, patch

    from api.generation.fal_preview_caller import call_fal_recipe_preview

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "images": [{"url": "https://cdn.fal.ai/result.webp"}]
    }

    with patch("httpx.Client") as mock_client_cls:
        mock_client = MagicMock()
        mock_client_cls.return_value.__enter__.return_value = mock_client
        mock_client.post.return_value = mock_response

        call_fal_recipe_preview(
            model_id="fal-ai/flux/dev",
            prompt="p",
            parameters={"num_inference_steps": 20, "guidance_scale": 7.5},
            api_key="k",
        )

        # Verify payload includes parameters
        call_args = mock_client.post.call_args
        payload = call_args.kwargs.get("json") or call_args[1].get("json", {})
        assert payload.get("num_inference_steps") == 20
        assert payload.get("guidance_scale") == 7.5
        assert payload.get("prompt") == "p"


@pytest.mark.unit
def test_call_fal_recipe_preview_includes_style_reference_when_provided() -> None:
    """call_fal_recipe_preview sends image_url when style_reference_url given."""
    from unittest.mock import MagicMock, patch

    from api.generation.fal_preview_caller import call_fal_recipe_preview

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "images": [{"url": "https://cdn.fal.ai/result.webp"}]
    }

    with patch("httpx.Client") as mock_client_cls:
        mock_client = MagicMock()
        mock_client_cls.return_value.__enter__.return_value = mock_client
        mock_client.post.return_value = mock_response

        call_fal_recipe_preview(
            model_id="fal-ai/flux/dev",
            prompt="p",
            style_reference_url="https://cdn.example.com/style.jpg",
            api_key="k",
        )

        call_args = mock_client.post.call_args
        payload = call_args.kwargs.get("json") or call_args[1].get("json", {})
        assert payload.get("image_url") == "https://cdn.example.com/style.jpg"


@pytest.mark.unit
def test_call_fal_recipe_preview_omits_image_url_when_none() -> None:
    """call_fal_recipe_preview does not send image_url when style_reference is None."""
    from unittest.mock import MagicMock, patch

    from api.generation.fal_preview_caller import call_fal_recipe_preview

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "images": [{"url": "https://cdn.fal.ai/result.webp"}]
    }

    with patch("httpx.Client") as mock_client_cls:
        mock_client = MagicMock()
        mock_client_cls.return_value.__enter__.return_value = mock_client
        mock_client.post.return_value = mock_response

        call_fal_recipe_preview(
            model_id="fal-ai/flux/dev",
            prompt="p",
            style_reference_url=None,
            api_key="k",
        )

        call_args = mock_client.post.call_args
        payload = call_args.kwargs.get("json") or call_args[1].get("json", {})
        assert "image_url" not in payload
