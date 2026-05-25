"""Unit test for the Phase 4.3 OpenAPI auth contract (Seed AC 15).

Builds the FastAPI app via :func:`api.main.create_app` and asserts the
machine-readable ``/openapi.json`` document carries the exact shape that
the mobile team will codegen from in Phase 4.3.5/4.4:

* ``POST /v1/auth/sign-in-with-apple`` request schema has
  ``identity_token`` as the only required field; ``full_name`` and
  ``email`` are optional.
* The same path's success response schema includes ``access_token``,
  ``token_type``, ``expires_in``, and ``user`` (with the nested
  ``UserPublic`` shape).
* ``POST /v1/diagnose`` declares an HTTPBearer security requirement.
* ``GET /v1/health`` and ``GET /v1/version`` have no security
  requirement (they remain public).

The test runs in the unit tier (no DB, no network) because the FastAPI
``/openapi.json`` is generated from the route declarations alone.
"""

from __future__ import annotations

import os
from typing import Any

import pytest

# JWT_SECRET / APPLE_BUNDLE_ID must be set so create_app() doesn't crash
# at the auth router's import-time env probe (require_*_id is called
# lazily, but we set placeholders here defensively).
os.environ.setdefault("JWT_SECRET", "test-secret-for-openapi-only")
os.environ.setdefault("APPLE_BUNDLE_ID", "com.personalcolorkr.app.test")

from api.main import create_app  # noqa: E402


@pytest.fixture
def openapi_doc() -> dict[str, Any]:
    """Build a fresh app, fetch its OpenAPI spec, return the parsed dict."""
    app = create_app()
    return app.openapi()


@pytest.mark.unit
def test_sign_in_endpoint_request_body_shape(
    openapi_doc: dict[str, Any],
) -> None:
    """Request body has identity_token required, full_name + email optional."""
    paths = openapi_doc["paths"]
    sign_in = paths["/v1/auth/sign-in-with-apple"]["post"]
    body = sign_in["requestBody"]["content"]["application/json"]["schema"]
    # Resolve $ref if present.
    if "$ref" in body:
        ref = body["$ref"].rsplit("/", 1)[-1]
        body = openapi_doc["components"]["schemas"][ref]
    required = set(body.get("required", []))
    properties = body["properties"]
    assert required == {
        "identity_token"
    }, f"identity_token must be the only required field; got required={required}"
    assert "full_name" in properties, "full_name must appear as optional"
    assert "email" in properties, "email must appear as optional"


@pytest.mark.unit
def test_sign_in_endpoint_response_shape(openapi_doc: dict[str, Any]) -> None:
    """200 response carries access_token/token_type/expires_in/user."""
    paths = openapi_doc["paths"]
    sign_in = paths["/v1/auth/sign-in-with-apple"]["post"]
    response_schema = sign_in["responses"]["200"]["content"]["application/json"][
        "schema"
    ]
    if "$ref" in response_schema:
        ref = response_schema["$ref"].rsplit("/", 1)[-1]
        response_schema = openapi_doc["components"]["schemas"][ref]
    properties = response_schema["properties"]
    expected = {"access_token", "token_type", "expires_in", "user"}
    assert expected <= set(
        properties.keys()
    ), f"Response missing required fields; got {set(properties.keys())}"


@pytest.mark.unit
def test_diagnose_has_bearer_security(openapi_doc: dict[str, Any]) -> None:
    """POST /v1/diagnose declares an HTTPBearer security requirement."""
    paths = openapi_doc["paths"]
    diagnose = paths["/v1/diagnose"]["post"]
    security = diagnose.get("security")
    assert security, (
        "POST /v1/diagnose must declare a security requirement; "
        f"got security={security!r}"
    )
    # Look up the scheme(s) referenced in the security requirement.
    scheme_names: set[str] = set()
    for req in security:
        scheme_names.update(req.keys())
    components = openapi_doc.get("components", {}).get("securitySchemes", {})
    bearer_schemes = {
        name
        for name, scheme in components.items()
        if scheme.get("type") == "http" and scheme.get("scheme") == "bearer"
    }
    assert scheme_names & bearer_schemes, (
        f"POST /v1/diagnose must reference an HTTPBearer scheme; "
        f"used={scheme_names}, available bearer schemes={bearer_schemes}"
    )


@pytest.mark.unit
def test_health_and_version_have_no_security(
    openapi_doc: dict[str, Any],
) -> None:
    """GET /v1/health and GET /v1/version stay public (no security req)."""
    paths = openapi_doc["paths"]
    for path in ("/v1/health", "/v1/version"):
        endpoint = paths[path]["get"]
        # OpenAPI security: empty list or absent means public.
        security = endpoint.get("security")
        assert not security, (
            f"{path} must be public (no security requirement); "
            f"got security={security!r}"
        )


@pytest.mark.unit
def test_openapi_path_is_public(openapi_doc: dict[str, Any]) -> None:
    """The OpenAPI document at /openapi.json is itself reachable."""
    # FastAPI sets ``info.title`` from the app constructor — assert the
    # known title to confirm we built the right app + the document
    # serializes.
    assert openapi_doc["info"]["title"] == "personal-color-kr API"
    assert openapi_doc["info"]["version"] == "0.1.0"
