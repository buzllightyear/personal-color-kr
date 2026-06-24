# 0002 — Feature reachability, definition-of-done, and the ratchet discipline

- **Status:** Accepted (2026-06-24)
- **Scope:** how we keep "built but incomplete" work from passing as done —
  generalized from a specific incident into a standing strategy.

## Context

The content-generation catalog (`(generate)` route group) shipped fully built
— catalog, gallery, generation, admin, metrics — passed every acceptance
criterion (AC1–AC5), and merged with green CI. Yet it was **unreachable on
device**: nothing in the app navigated into the group, and it was excluded from
the deep-link allowlist by design. The feature was an orphan that every check
called "done."

The root cause was not a bug; it was a **hole in the definition of done**. The
ACs covered the surface's internals but never "the user can reach this." The
work was AC-driven (an ouroboros Seed generated the AC set), so a gap in the AC
set became a gap in reality — invisibly, because everything that *was* specified
passed. The "decoupled / independent tab" framing actively disguised the hole,
and the deferred integration lived only as a `(future)` aside in a code comment,
never promoted to a tracked deliverable.

The deeper realization: **the space of failure modes is unbounded.** No finite
set of checks can pre-cover it. A detector-per-bug-class does not scale.

## Decision

Treat completeness/correctness as **defense in depth across three layers**, each
with different scaling properties. The goal is not coverage-by-enumeration
(impossible) but the product of three independent filters:

**1. Ratchet — mechanical, post-incident.** Every process failure earns a
permanent, cheap, deterministic guard, exactly as a code bug earns a regression
test. Bounded cost (one guard per real incident); guarantees **zero repeat** of
a *seen* class. It does not cover unseen classes — that is not its job.
First instance: `scripts/check-route-reachability.mjs` (CI), which fails when an
Expo Router group has no inbound navigation. Future incidents add sibling
guards under `scripts/` + a CI step.

**2. Generative critic — agent, judgment.** The only thing that catches *unseen*
classes, because it reasons rather than pattern-matches. A few generative
questions ("what's missing / built-but-not-connected / unverified?") cover an
open-ended set. Probabilistic — a backstop, never the primary defense. Captured
as the review dimension in `docs/review-checklist.md`.

**3. Prevention at the source — DoD / planning template.** Cheaper than
inspecting output: stop *generating* gaps. Definition of done for any
user-facing surface MUST include **reachability/integration**, not just the
surface's internals. Deferred work MUST be promoted to a tracked item (issue or
ADR), never left as `(future)` in a comment, where it evaporates.

## Consequences

- A new fully-built route group that nobody wired now **fails CI**, not review
  three weeks later.
- "Done" for a feature means reachable + integrated + (deferrals tracked), not
  "all ACs green."
- When a novel failure class slips through, the response is not just a fix: add
  a ratchet guard (layer 1) and, if it reveals a recurring blind spot, a
  question to the critic checklist (layer 2).
- Honest limits: layer 1 only catches what we've seen; layer 2 leaks
  (false negatives); layer 3 depends on discipline. None is a silver bullet —
  the strategy is their product, and the guards must stay simple enough to be
  self-evidently correct.

## Relation to the reliability ladder (ADR 0001)

This is the ladder applied to *completeness*: push each concern as high as it
will go. Reachability was pushable to rung 2 (a mechanical CI guard) — so we did
that. The unbounded tail can only sit at rung 3 (a reasoning critic) and rung 1
of prevention (a DoD template). See [0001](0001-toolchain-pinning.md).
