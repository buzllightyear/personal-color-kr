# Review checklist — the completeness critic

The generative-critic layer from [ADR 0002](decisions/0002-feature-reachability.md).
Mechanical CI guards catch *seen* failure classes; this checklist is the
reasoning backstop for the *unbounded tail* they cannot. Run it on every
feature PR — by a human reviewer and/or `code-review ultra`. It is deliberately
made of **generative questions**, not a fixed pass/fail list: the point is to
reason about what is *missing*, which no static check can enumerate.

A "no" is not an automatic block — it is a prompt to either fix, or record a
tracked deferral (issue/ADR), or justify in the PR. Silence is the failure mode.

## Reachability & integration
- **Can a real user reach this?** Trace the path from app entry. A built screen
  with no inbound navigation is an orphan even with green tests
  (the `scripts/check-route-reachability.mjs` class — but it also covers buttons,
  conditions, and feature flags the script can't see).
- **Is anything built-but-disconnected?** New API endpoint with no caller? New
  state slice never read? New component never mounted? New config never loaded?
- **Auth/gating:** does reaching it require a state (sign-in, payment, flag)
  that's actually attainable in the relevant build/environment?

## Definition of done
- **Does "done" include integration, not just the surface's internals?** "Build
  X" is not "connect X to the app." Re-read the AC/spec set and ask what it
  *didn't* enumerate.
- **End-to-end, not unit-only:** is there a path that exercises the whole feature
  the way a user would, or only isolated parts?

## Deferrals & truth
- **Is every deferral tracked?** A `TODO` / `(future)` / "Phase N scaffold" in a
  comment evaporates. Promote it to an issue or ADR, or it didn't happen.
- **Is every claim verified?** "Works", "done", "tested" — by what evidence?
  Distinguish verified from assumed; mark hypotheses as hypotheses.
- **Does the change make any prior record wrong?** Memory/docs/ADRs that this PR
  contradicts must be corrected in the same change.

## Ratchet
- **Did a novel failure class slip through to get here?** If so, the fix is not
  enough: add a mechanical guard (`scripts/` + CI) so this class cannot recur,
  and — if it's a recurring blind spot — a question to this checklist.
