"""Service-layer package for apps/api (Phase 7.1).

Hosts in-process, framework-light service objects that live for the
lifetime of a single uvicorn worker and are shared via
``app.state`` (never module-level globals). The first inhabitant is
:class:`api.services.latency_aggregator.LatencyAggregator`.
"""
