"""Integration test tier for apps/api.

Tests in this directory are marked ``@pytest.mark.integration`` and exercise
real external dependencies — most importantly a running Postgres 16
container (docker-compose locally, GitHub Actions ``services: postgres:`` in
CI). The Seed's test-seam contract reserves the integration tier for
cross-module / external-I/O coverage; unit-tier tests (``apps/api/tests/unit``)
remain pure stdlib + ASGI in-process.

When ``DATABASE_URL`` is not set in the environment, the integration tests
in this directory skip themselves via ``@pytest.mark.skipif`` so a fresh
checkout (no ``.env``, no docker-compose) can still run ``pytest -q
apps/api/tests`` and stay green.
"""
