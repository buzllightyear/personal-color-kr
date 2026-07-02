"""Unit tests for AC2: ``POST /v1/generate`` end-to-end generation endpoint.

Wires the committed ``personal_color.generate`` backend (orchestrator →
rejection → watermark) behind an authenticated HTTP endpoint that accepts a
recipe id + a freshly captured selfie and returns the **server-side
watermarked** image bytes within the 30 s budget.

Test strategy
-------------
``create_app()`` with ``dependency_overrides``:

* ``get_session`` → an in-memory stub returning a single published recipe.
* ``require_current_user`` → auto-stubbed by the unit conftest (auth-bypassed),
  popped in the auth-gate test so the real 401 path runs.
* ``get_generate_runner`` → a stub runner so no real fal.ai / NSFW HTTP calls
  happen. The stub returns an :class:`OrchestrationResult` (or raises
  :class:`GenerationBudgetExhaustedError`) exactly as the production runner
  would, keeping the endpoint isolated from the vendor seam.

The watermark step is exercised for real (pure-PIL, fast) so the success test
asserts the response body is a valid, non-empty PNG.
"""

from __future__ import annotations

import io
import uuid
from collections.abc import AsyncGenerator
from datetime import datetime, timezone
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

from api.db.models.recipe import (
    RECIPE_STATUS_DELETED,
    RECIPE_STATUS_HIDDEN,
    RECIPE_STATUS_PUBLISHED,
    Recipe,
)
from api.db.models.user import User
from api.db.session import get_session
from api.dependencies.auth import require_current_user
from api.dependencies.generate import get_generate_runner
from api.dependencies.storage import get_object_storage
from api.main import create_app
from api.storage.object_storage import InMemoryObjectStorage
from personal_color.generate.fal_client import FalGenerationConfig, GenerationInputs
from personal_color.generate.orchestrator import (
    GenerationBudgetExhaustedError,
    OrchestrationResult,
)
from personal_color.generate.rejection import RejectionVerdict

_BASE_URL = "http://testserver"
_GENERATE_URL = "/v1/generate"
_NOW = datetime.now(timezone.utc)


def _png_bytes(color: tuple[int, int, int] = (120, 90, 200)) -> bytes:
    """Return a small valid PNG for use as a fake generation result."""
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), color).save(buf, format="PNG")
    return buf.getvalue()


def _passed_verdict() -> RejectionVerdict:
    return RejectionVerdict(
        nsfw_flag=False,
        artifact_flag=False,
        passed=True,
        nsfw_score=0.0,
        artifact_score=0.0,
        reject_reason=None,
    )


def _make_recipe(
    *,
    recipe_id: str,
    status: str = RECIPE_STATUS_PUBLISHED,
    model_id: str = "fal-ai/flux/dev/image-to-image",
    prompt_template: str = "An editorial portrait, soft studio light",
) -> Recipe:
    recipe = Recipe()
    recipe.id = uuid.uuid4()
    recipe.recipe_id = recipe_id
    recipe.model_id = model_id
    recipe.prompt_template = prompt_template
    recipe.style_reference_key = None
    recipe.parameters = {"num_inference_steps": 28}
    recipe.status = status
    recipe.publish_date = _NOW
    recipe.display_order = 0
    recipe.created_at = _NOW
    recipe.updated_at = _NOW
    return recipe


class _StubResult:
    def __init__(self, rows: list[Recipe]) -> None:
        self._rows = rows

    def scalar_one_or_none(self) -> Recipe | None:
        return self._rows[0] if self._rows else None


class _OneRecipeSession:
    """Stub session: returns the recipe whose recipe_id matches the query.

    Also records ``add`` / ``commit`` calls so the AC4 persistence path
    (storing a :class:`Generation` row) can be asserted without a real DB.
    """

    def __init__(self, recipes: list[Recipe]) -> None:
        self._recipes = list(recipes)
        self.added: list[Any] = []
        self.commits = 0

    async def execute(self, stmt: Any) -> _StubResult:
        rows = list(self._recipes)
        whereclause = getattr(stmt, "whereclause", None)
        if whereclause is not None:
            try:
                col_name = str(whereclause.left.key)
                value = whereclause.right.value
                rows = [r for r in rows if getattr(r, col_name, None) == value]
            except AttributeError:
                pass
        return _StubResult(rows)

    def add(self, obj: Any) -> None:
        self.added.append(obj)

    async def commit(self) -> None:
        self.commits += 1


def _known_user() -> User:
    user = User()
    user.id = uuid.uuid4()
    user.apple_sub = "stub-apple-sub-for-generate-tests"
    user.email = None
    user.email_verified = False
    user.display_name = None
    user.referral_code = "AAAAAAAA"
    user.referrer_user_id = None
    user.created_at = _NOW
    user.updated_at = _NOW
    return user


def _build_app(
    recipes: list[Recipe],
    runner: Any,
    *,
    session: _OneRecipeSession | None = None,
    storage: InMemoryObjectStorage | None = None,
) -> Any:
    app = create_app()
    stub = session if session is not None else _OneRecipeSession(recipes)
    store = storage if storage is not None else InMemoryObjectStorage()

    async def _stub_session() -> AsyncGenerator[_OneRecipeSession, None]:
        yield stub

    app.dependency_overrides[get_session] = _stub_session
    app.dependency_overrides[require_current_user] = _known_user
    app.dependency_overrides[get_generate_runner] = lambda: runner
    app.dependency_overrides[get_object_storage] = lambda: store
    return app


@pytest.mark.asyncio
async def test_generate_returns_watermarked_png_on_success() -> None:
    captured: dict[str, Any] = {}

    def _runner(
        config: FalGenerationConfig, inputs: GenerationInputs
    ) -> OrchestrationResult:
        captured["config"] = config
        captured["inputs"] = inputs
        return OrchestrationResult(
            image_bytes=_png_bytes(),
            retry_count=2,
            last_verdict=_passed_verdict(),
        )

    session = _OneRecipeSession([_make_recipe(recipe_id="r-001")])
    storage = InMemoryObjectStorage()
    app = _build_app([], _runner, session=session, storage=storage)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url=_BASE_URL) as client:
        resp = await client.post(
            _GENERATE_URL,
            data={"recipe_id": "r-001"},
            files={"selfie": ("selfie.png", _png_bytes((10, 10, 10)), "image/png")},
        )

    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    assert resp.headers["x-generation-retry-count"] == "2"
    # Body is a valid, non-empty PNG (the watermark step ran for real).
    assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"
    out = Image.open(io.BytesIO(resp.content))
    assert out.size == (64, 64)
    # The handler forwarded the recipe-derived config + inputs to the runner.
    # BACKWARD-COMPAT PIN: a request with only recipe_id + selfie (the current
    # mobile client's exact multipart shape) yields garment_bytes=None and the
    # single reference mode for the i2i baseline model.
    assert captured["config"].model_id == "fal-ai/flux/dev/image-to-image"
    assert captured["config"].prompt == "An editorial portrait, soft studio light"
    assert captured["config"].parameters == {"num_inference_steps": 28}
    assert captured["config"].reference_mode == "single"
    assert captured["inputs"].selfie_bytes == _png_bytes((10, 10, 10))
    assert captured["inputs"].garment_bytes is None

    # AC4 — the watermarked result is persisted: one gallery row committed,
    # its bytes stored under the row's key, and the id echoed in the header.
    assert session.commits == 1
    assert len(session.added) == 1
    row = session.added[0]
    assert row.recipe_id == "r-001"
    assert row.retry_count == 2
    assert resp.headers["x-generation-id"] == str(row.id)
    # The bytes in storage are exactly the watermarked PNG that was returned.
    assert storage.get(row.result_image_key) == resp.content


@pytest.mark.asyncio
async def test_generate_succeeds_even_when_persistence_fails() -> None:
    """A storage failure must not fail a delivered image (best-effort persist)."""

    class _FailingStorage(InMemoryObjectStorage):
        def put(self, key: str, data: bytes, content_type: str) -> None:
            raise RuntimeError("storage down")

    def _runner(
        config: FalGenerationConfig, inputs: GenerationInputs
    ) -> OrchestrationResult:
        return OrchestrationResult(
            image_bytes=_png_bytes(),
            retry_count=0,
            last_verdict=_passed_verdict(),
        )

    session = _OneRecipeSession([_make_recipe(recipe_id="r-001")])
    app = _build_app([], _runner, session=session, storage=_FailingStorage())
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url=_BASE_URL) as client:
        resp = await client.post(
            _GENERATE_URL,
            data={"recipe_id": "r-001"},
            files={"selfie": ("s.png", _png_bytes(), "image/png")},
        )

    # Image still delivered (200 + PNG); no gallery row; no id header.
    assert resp.status_code == 200
    assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert session.commits == 0
    assert session.added == []
    assert "x-generation-id" not in resp.headers


@pytest.mark.asyncio
async def test_generate_unknown_recipe_returns_404() -> None:
    def _runner(
        config: FalGenerationConfig, inputs: GenerationInputs
    ) -> OrchestrationResult:
        raise AssertionError("runner must not be called for an unknown recipe")

    app = _build_app([_make_recipe(recipe_id="r-001")], _runner)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url=_BASE_URL) as client:
        resp = await client.post(
            _GENERATE_URL,
            data={"recipe_id": "does-not-exist"},
            files={"selfie": ("s.png", _png_bytes(), "image/png")},
        )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "recipe_not_found"


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [RECIPE_STATUS_HIDDEN, RECIPE_STATUS_DELETED])
async def test_generate_non_published_recipe_returns_404(status: str) -> None:
    def _runner(
        config: FalGenerationConfig, inputs: GenerationInputs
    ) -> OrchestrationResult:
        raise AssertionError("runner must not be called for a non-published recipe")

    app = _build_app([_make_recipe(recipe_id="r-001", status=status)], _runner)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url=_BASE_URL) as client:
        resp = await client.post(
            _GENERATE_URL,
            data={"recipe_id": "r-001"},
            files={"selfie": ("s.png", _png_bytes(), "image/png")},
        )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "recipe_not_found"


@pytest.mark.asyncio
async def test_generate_text_to_image_model_returns_503() -> None:
    """A recipe carrying a text-to-image model id fails loud (no silent stranger).

    ``fal-ai/flux/dev`` (t2i) has no ``image_url`` field, so the uploaded selfie
    would be silently ignored. The defense-in-depth guard rejects such a recipe
    with 503 ``generation_unavailable`` and never calls the runner.
    """

    def _runner(
        config: FalGenerationConfig, inputs: GenerationInputs
    ) -> OrchestrationResult:
        raise AssertionError("runner must not be called for a t2i-misconfigured recipe")

    app = _build_app(
        [_make_recipe(recipe_id="r-001", model_id="fal-ai/flux/dev")], _runner
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url=_BASE_URL) as client:
        resp = await client.post(
            _GENERATE_URL,
            data={"recipe_id": "r-001"},
            files={"selfie": ("s.png", _png_bytes(), "image/png")},
        )
    assert resp.status_code == 503
    assert resp.json()["detail"] == "generation_unavailable"


@pytest.mark.asyncio
async def test_generate_strips_unfilled_personal_color_placeholder() -> None:
    """The literal ``{personal_color_modifier}`` slot is removed before fal.

    Diagnosis output is intentionally not injected into the prompt, so the
    placeholder must not be shipped verbatim — the config the runner receives
    carries the tidied prompt with no brace token.
    """
    captured: dict[str, Any] = {}

    def _runner(
        config: FalGenerationConfig, inputs: GenerationInputs
    ) -> OrchestrationResult:
        captured["config"] = config
        return OrchestrationResult(
            image_bytes=_png_bytes(),
            retry_count=0,
            last_verdict=_passed_verdict(),
        )

    recipe = _make_recipe(
        recipe_id="r-001",
        prompt_template="fresh summer look, clean skin, {personal_color_modifier}",
    )
    app = _build_app([recipe], _runner)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url=_BASE_URL) as client:
        resp = await client.post(
            _GENERATE_URL,
            data={"recipe_id": "r-001"},
            files={"selfie": ("s.png", _png_bytes(), "image/png")},
        )
    assert resp.status_code == 200
    assert "{personal_color_modifier}" not in captured["config"].prompt
    assert captured["config"].prompt == "fresh summer look, clean skin"


@pytest.mark.asyncio
async def test_generate_budget_exhausted_returns_503() -> None:
    def _runner(
        config: FalGenerationConfig, inputs: GenerationInputs
    ) -> OrchestrationResult:
        raise GenerationBudgetExhaustedError(
            "budget exhausted", retry_count=4, last_reject_reason="artifact"
        )

    app = _build_app([_make_recipe(recipe_id="r-001")], _runner)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url=_BASE_URL) as client:
        resp = await client.post(
            _GENERATE_URL,
            data={"recipe_id": "r-001"},
            files={"selfie": ("s.png", _png_bytes(), "image/png")},
        )
    assert resp.status_code == 503
    assert resp.json()["detail"] == "generation_failed"


@pytest.mark.asyncio
async def test_generate_with_garment_on_multi_model_forwards_garment() -> None:
    """Garment + a multi-reference (*/edit) recipe → 200; the runner receives
    the garment bytes and a multi-mode config."""
    captured: dict[str, Any] = {}

    def _runner(
        config: FalGenerationConfig, inputs: GenerationInputs
    ) -> OrchestrationResult:
        captured["config"] = config
        captured["inputs"] = inputs
        return OrchestrationResult(
            image_bytes=_png_bytes(),
            retry_count=0,
            last_verdict=_passed_verdict(),
        )

    garment = _png_bytes((200, 30, 30))
    recipe = _make_recipe(recipe_id="r-001", model_id="fal-ai/flux-2/edit")
    app = _build_app([recipe], _runner)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url=_BASE_URL) as client:
        resp = await client.post(
            _GENERATE_URL,
            data={"recipe_id": "r-001"},
            files={
                "selfie": ("s.png", _png_bytes((10, 10, 10)), "image/png"),
                "garment": ("g.png", garment, "image/png"),
            },
        )

    assert resp.status_code == 200
    assert captured["config"].reference_mode == "multi"
    assert captured["inputs"].garment_bytes == garment
    assert captured["inputs"].selfie_bytes == _png_bytes((10, 10, 10))


@pytest.mark.asyncio
async def test_generate_garment_on_single_model_returns_422() -> None:
    """Garment + a single-reference recipe → 422 garment_not_supported; the
    runner is never called (no fal spend on a doomed request)."""

    def _runner(
        config: FalGenerationConfig, inputs: GenerationInputs
    ) -> OrchestrationResult:
        raise AssertionError("runner must not be called for garment_not_supported")

    recipe = _make_recipe(recipe_id="r-001", model_id="fal-ai/flux/dev/image-to-image")
    app = _build_app([recipe], _runner)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url=_BASE_URL) as client:
        resp = await client.post(
            _GENERATE_URL,
            data={"recipe_id": "r-001"},
            files={
                "selfie": ("s.png", _png_bytes(), "image/png"),
                "garment": ("g.png", _png_bytes((200, 30, 30)), "image/png"),
            },
        )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "garment_not_supported"


@pytest.mark.asyncio
async def test_generate_empty_garment_returns_422_not_500() -> None:
    """A present-but-empty garment part is a 422 wire error, never a 500
    (GenerationInputs' ValueError backstop must not be reachable)."""

    def _runner(
        config: FalGenerationConfig, inputs: GenerationInputs
    ) -> OrchestrationResult:
        raise AssertionError("runner must not be called for an empty garment")

    recipe = _make_recipe(recipe_id="r-001", model_id="fal-ai/flux-2/edit")
    app = _build_app([recipe], _runner)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url=_BASE_URL) as client:
        resp = await client.post(
            _GENERATE_URL,
            data={"recipe_id": "r-001"},
            files={
                "selfie": ("s.png", _png_bytes(), "image/png"),
                "garment": ("g.png", b"", "image/png"),
            },
        )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "empty_file"


@pytest.mark.asyncio
async def test_generate_garment_with_bad_content_type_returns_415() -> None:
    def _runner(
        config: FalGenerationConfig, inputs: GenerationInputs
    ) -> OrchestrationResult:
        raise AssertionError("runner must not be called for a bad garment type")

    recipe = _make_recipe(recipe_id="r-001", model_id="fal-ai/flux-2/edit")
    app = _build_app([recipe], _runner)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url=_BASE_URL) as client:
        resp = await client.post(
            _GENERATE_URL,
            data={"recipe_id": "r-001"},
            files={
                "selfie": ("s.png", _png_bytes(), "image/png"),
                "garment": ("g.gif", _png_bytes(), "image/gif"),
            },
        )

    assert resp.status_code == 415
    assert resp.json()["detail"] == "unsupported_media_type"


@pytest.mark.asyncio
async def test_generate_multi_model_without_garment_still_works() -> None:
    """A multi-reference recipe with NO garment stays valid — the seam sends
    image_urls=[selfie] downstream (selfie-only generation on an edit model)."""
    captured: dict[str, Any] = {}

    def _runner(
        config: FalGenerationConfig, inputs: GenerationInputs
    ) -> OrchestrationResult:
        captured["config"] = config
        captured["inputs"] = inputs
        return OrchestrationResult(
            image_bytes=_png_bytes(),
            retry_count=0,
            last_verdict=_passed_verdict(),
        )

    recipe = _make_recipe(recipe_id="r-001", model_id="fal-ai/qwen-image-2/edit")
    app = _build_app([recipe], _runner)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url=_BASE_URL) as client:
        resp = await client.post(
            _GENERATE_URL,
            data={"recipe_id": "r-001"},
            files={"selfie": ("s.png", _png_bytes(), "image/png")},
        )

    assert resp.status_code == 200
    assert captured["config"].reference_mode == "multi"
    assert captured["inputs"].garment_bytes is None


@pytest.mark.asyncio
async def test_generate_requires_authentication() -> None:
    def _runner(
        config: FalGenerationConfig, inputs: GenerationInputs
    ) -> OrchestrationResult:
        raise AssertionError("runner must not be called when unauthenticated")

    app = _build_app([_make_recipe(recipe_id="r-001")], _runner)
    # Drop the auto-stub so the real require_current_user runs (→ 401).
    app.dependency_overrides.pop(require_current_user, None)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url=_BASE_URL) as client:
        resp = await client.post(
            _GENERATE_URL,
            data={"recipe_id": "r-001"},
            files={"selfie": ("s.png", _png_bytes(), "image/png")},
        )
    assert resp.status_code == 401
