"""Unit tests for the AWS SigV4 signer (AC4 object-storage signing).

The core HMAC chain is pinned to AWS's own published reference output: the
canonical ``get-vanilla`` test vector from the AWS SigV4 test suite documents a
fixed request + credentials and the exact expected signature. Reproducing it
proves the canonical-request → string-to-sign → signing-key → signature chain
matches AWS byte-for-byte, which is the only part that must be correct for the
S3/R2 adapter to authenticate.
"""

from __future__ import annotations

from api.storage.sigv4 import (
    ALGORITHM,
    EMPTY_PAYLOAD_SHA256,
    derive_signature,
    sign_request,
)

# ---------------------------------------------------------------------------
# AWS canonical "get-vanilla" SigV4 test vector
# ---------------------------------------------------------------------------
# Credentials + scope from the AWS-published SigV4 test suite:
#   access key : AKIDEXAMPLE
#   secret key : wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY
#   region     : us-east-1
#   service    : service
#   timestamp  : 20150830T123600Z   (datestamp 20150830)
#
# Request: GET https://example.amazonaws.com/   with headers host + x-amz-date.
_VECTOR_SECRET = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY"
_VECTOR_ACCESS = "AKIDEXAMPLE"
_VECTOR_REGION = "us-east-1"
_VECTOR_SERVICE = "service"
_VECTOR_AMZ_DATE = "20150830T123600Z"
_VECTOR_DATESTAMP = "20150830"
_VECTOR_EXPECTED_SIGNATURE = (
    "5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31"
)


def test_derive_signature_matches_aws_get_vanilla_vector() -> None:
    """The HMAC chain reproduces AWS's documented get-vanilla signature."""
    # The canonical request for get-vanilla (empty path "/", empty query,
    # signed headers host;x-amz-date, empty-payload hash).
    canonical_request = "\n".join(
        [
            "GET",
            "/",
            "",
            "host:example.amazonaws.com",
            "x-amz-date:20150830T123600Z",
            "",
            "host;x-amz-date",
            EMPTY_PAYLOAD_SHA256,
        ]
    )
    signature = derive_signature(
        canonical_request=canonical_request,
        amz_date=_VECTOR_AMZ_DATE,
        datestamp=_VECTOR_DATESTAMP,
        region=_VECTOR_REGION,
        service=_VECTOR_SERVICE,
        secret_access_key=_VECTOR_SECRET,
    )
    assert signature == _VECTOR_EXPECTED_SIGNATURE


def test_sign_request_builds_authorization_header() -> None:
    """``sign_request`` assembles a well-formed Authorization header."""
    signed = sign_request(
        method="PUT",
        host="bucket.r2.example.com",
        path="/my-bucket/generations/u/abc.png",
        region="auto",
        service="s3",
        access_key_id="AKID",
        secret_access_key="SECRET",
        amz_date="20260622T000000Z",
        datestamp="20260622",
        payload_hash="deadbeef",
        extra_signed_headers={"content-type": "image/png"},
    )
    auth = signed.headers["Authorization"]
    assert auth.startswith(f"{ALGORITHM} ")
    assert "Credential=AKID/20260622/auto/s3/aws4_request" in auth
    # content-type is included in the signed-headers set (sorted, lowercased).
    assert "SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date" in auth
    assert f"Signature={signed.signature}" in auth
    # x-amz-content-sha256 carries the supplied payload hash.
    assert signed.headers["x-amz-content-sha256"] == "deadbeef"
    # ``host`` remains part of the signed set (Authorization references it).
    assert signed.headers["host"] == "bucket.r2.example.com"


def test_sign_request_bodyless_uses_empty_payload_hash() -> None:
    """A GET with no extra headers signs host;x-amz-content-sha256;x-amz-date."""
    signed = sign_request(
        method="GET",
        host="bucket.r2.example.com",
        path="/my-bucket/key.png",
        region="auto",
        service="s3",
        access_key_id="AKID",
        secret_access_key="SECRET",
        amz_date="20260622T000000Z",
        datestamp="20260622",
        payload_hash=EMPTY_PAYLOAD_SHA256,
    )
    assert (
        "SignedHeaders=host;x-amz-content-sha256;x-amz-date"
        in signed.headers["Authorization"]
    )
