"""AWS Signature Version 4 request signer (Content Generation AC4).

The object-storage adapter (:mod:`api.storage.s3_object_storage`) talks to an
S3-compatible REST API (AWS S3 or Cloudflare R2). Both authenticate requests
with **AWS Signature Version 4** — an HMAC-SHA256 signature over a canonical
form of the request, carried in the ``Authorization`` header.

Rather than pull in ``boto3`` (a heavy dependency that also drags ``mypy
--strict`` type-stub friction), this module implements the SigV4 *header*
signing scheme with the standard library (``hashlib`` / ``hmac``) and lets the
adapter ship the signed headers via the already-present ``httpx`` client.

Scope
-----
This implements the header-based ("Authorization header") variant used for
``PUT`` / ``GET`` / ``DELETE`` object operations. The query-string presign
variant is intentionally not implemented — the gallery streams images through
an authenticated API endpoint rather than handing out presigned URLs, so the
original never egresses and no time-boxed public URL is minted.

Correctness
-----------
The :func:`derive_signature` core is verified in the unit test against the
canonical AWS ``get-vanilla`` SigV4 test vector (the documented
``AKIDEXAMPLE`` example with its published expected signature), so the
canonical-request → string-to-sign → signing-key → signature chain is pinned
to AWS's own reference output.
"""

from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass
from typing import Final
from urllib.parse import quote

#: The SigV4 algorithm identifier carried in the credential scope + signature.
ALGORITHM: Final[str] = "AWS4-HMAC-SHA256"

#: The terminating string of the SigV4 credential scope.
SCOPE_TERMINATOR: Final[str] = "aws4_request"

#: SHA-256 hex digest of the empty byte string — the payload hash for a body
#: less request (GET / DELETE). Precomputed so callers need not hash ``b""``.
EMPTY_PAYLOAD_SHA256: Final[str] = hashlib.sha256(b"").hexdigest()


def sha256_hex(data: bytes) -> str:
    """Return the lowercase hex SHA-256 digest of *data*."""
    return hashlib.sha256(data).hexdigest()


def _hmac_sha256(key: bytes, msg: str) -> bytes:
    """Return ``HMAC-SHA256(key, msg)`` with *msg* encoded as UTF-8."""
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def _derive_signing_key(
    secret_access_key: str, datestamp: str, region: str, service: str
) -> bytes:
    """Derive the SigV4 signing key via the four-step HMAC chain.

    ``kDate = HMAC("AWS4"+secret, date)`` → ``kRegion`` → ``kService`` →
    ``kSigning = HMAC(kService, "aws4_request")``.
    """
    k_date = _hmac_sha256(("AWS4" + secret_access_key).encode("utf-8"), datestamp)
    k_region = _hmac_sha256(k_date, region)
    k_service = _hmac_sha256(k_region, service)
    return _hmac_sha256(k_service, SCOPE_TERMINATOR)


def _canonical_uri(path: str) -> str:
    """URI-encode each path segment per SigV4 (RFC 3986, slashes preserved).

    S3/R2 object keys may contain characters (``/``, ``.``) that must be
    encoded selectively: path separators stay literal, every other reserved
    character is percent-encoded. ``quote(safe="/-_.~")`` matches the SigV4
    canonical-URI rules for the non-S3 ``UriEncode`` (S3 keeps ``/`` unencoded).
    """
    if not path.startswith("/"):
        path = "/" + path
    return quote(path, safe="/-_.~")


@dataclass(frozen=True)
class SignedRequest:
    """The headers to attach to an outgoing signed request.

    ``headers`` already includes ``Authorization``, ``x-amz-date``,
    ``x-amz-content-sha256`` and ``host``; the caller merges any of its own
    (e.g. ``Content-Type``) that were *also* part of ``signed_headers``.
    """

    headers: dict[str, str]
    signature: str


def derive_signature(
    *,
    canonical_request: str,
    amz_date: str,
    datestamp: str,
    region: str,
    service: str,
    secret_access_key: str,
) -> str:
    """Compute the SigV4 hex signature for a prepared canonical request.

    Pure HMAC chain — exposed separately from :func:`sign_request` so the unit
    test can drive it directly against the canonical AWS test vector.

    Parameters
    ----------
    canonical_request:
        The fully-assembled canonical request string.
    amz_date:
        The ``YYYYMMDDTHHMMSSZ`` request timestamp.
    datestamp:
        The ``YYYYMMDD`` portion used in the credential scope + signing key.
    region, service:
        The SigV4 credential-scope region and service (``s3`` here).
    secret_access_key:
        The secret signing key.

    Returns
    -------
    str
        The lowercase hex signature.
    """
    credential_scope = f"{datestamp}/{region}/{service}/{SCOPE_TERMINATOR}"
    string_to_sign = "\n".join(
        [
            ALGORITHM,
            amz_date,
            credential_scope,
            sha256_hex(canonical_request.encode("utf-8")),
        ]
    )
    signing_key = _derive_signing_key(secret_access_key, datestamp, region, service)
    return hmac.new(
        signing_key, string_to_sign.encode("utf-8"), hashlib.sha256
    ).hexdigest()


def sign_request(
    *,
    method: str,
    host: str,
    path: str,
    region: str,
    service: str,
    access_key_id: str,
    secret_access_key: str,
    amz_date: str,
    datestamp: str,
    payload_hash: str,
    extra_signed_headers: dict[str, str] | None = None,
) -> SignedRequest:
    """Sign an S3/R2 object request and return the headers to send.

    Builds the canonical request from a fixed, sorted set of signed headers
    (``host``, ``x-amz-content-sha256``, ``x-amz-date`` plus any
    ``extra_signed_headers`` such as ``content-type``), derives the signature,
    and assembles the ``Authorization`` header.

    Parameters
    ----------
    method:
        HTTP verb (``PUT`` / ``GET`` / ``DELETE``).
    host:
        The request ``Host`` header (endpoint host, no scheme).
    path:
        The object path (``/<bucket>/<key>``); encoded per SigV4.
    region, service:
        SigV4 credential-scope region and service.
    access_key_id, secret_access_key:
        The signing credentials. The secret never appears in the result.
    amz_date, datestamp:
        The request timestamp (``…TZ``) and its date prefix (``YYYYMMDD``).
    payload_hash:
        Hex SHA-256 of the request body (``EMPTY_PAYLOAD_SHA256`` for no body).
    extra_signed_headers:
        Additional headers to include in the signature (lowercased keys), e.g.
        ``{"content-type": "image/png"}`` for a ``PUT``.

    Returns
    -------
    SignedRequest
        The headers to attach (including ``Authorization``).
    """
    headers_to_sign: dict[str, str] = {
        "host": host,
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
    }
    if extra_signed_headers:
        for key, value in extra_signed_headers.items():
            headers_to_sign[key.lower()] = value.strip()

    sorted_keys = sorted(headers_to_sign)
    canonical_headers = "".join(f"{k}:{headers_to_sign[k]}\n" for k in sorted_keys)
    signed_headers = ";".join(sorted_keys)

    canonical_request = "\n".join(
        [
            method,
            _canonical_uri(path),
            "",  # canonical query string — always empty for these object ops
            canonical_headers,
            signed_headers,
            payload_hash,
        ]
    )

    signature = derive_signature(
        canonical_request=canonical_request,
        amz_date=amz_date,
        datestamp=datestamp,
        region=region,
        service=service,
        secret_access_key=secret_access_key,
    )

    credential_scope = f"{datestamp}/{region}/{service}/{SCOPE_TERMINATOR}"
    authorization = (
        f"{ALGORITHM} "
        f"Credential={access_key_id}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, "
        f"Signature={signature}"
    )

    out_headers = dict(headers_to_sign)
    out_headers["Authorization"] = authorization
    return SignedRequest(headers=out_headers, signature=signature)


__all__ = [
    "ALGORITHM",
    "SCOPE_TERMINATOR",
    "EMPTY_PAYLOAD_SHA256",
    "SignedRequest",
    "sha256_hex",
    "derive_signature",
    "sign_request",
]
