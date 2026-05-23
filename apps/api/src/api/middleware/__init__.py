"""FastAPI middleware modules for the apps/api workspace (Phase 4.1).

Hosts the single request_id middleware that is the source of truth for
per-request correlation. The JSON log formatter consumes
``request.state.request_id`` so every request emits exactly one log record
tagged with the same UUID4 that appears on the ``X-Request-ID`` response
header.
"""
