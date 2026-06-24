# 0001 — Pin the toolchain; enforce by machine; update deliberately

- **Status:** Accepted (2026-06-24)
- **Scope:** package manager, Node, and the dependency-update workflow. The
  governing principle below applies more broadly to any *enforceable* invariant.

## Context

CI broke when a `pnpm install --frozen-lockfile` run rejected the committed
lockfile (`ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`). Root cause: local dev had
drifted to **pnpm 10** while CI was pinned to **pnpm 9**, and the two majors
write the `patchedDependencies` hash with different algorithms. The only thing
"pinning" the version was a sentence in `CLAUDE.md` — a passive doc that nothing
enforced, so the environment was free to drift.

The failure was caused by **inconsistency, not age**. "Always use the latest
version" would not have prevented it (two machines on *latest* at different times
still diverge) and adds unvetted-release risk plus non-reproducibility.

## Decision

Adopt the governing principle:

> **Pin one → the machine enforces → bump deliberately via PR.**
> Optimize for consistency/reproducibility, not recency.

Concretely:

1. **Pin** the package manager and pnpm major in one authoritative place —
   `package.json` `packageManager: "pnpm@10.x"` (corepack honors it for local,
   CI, and EAS Build). Node floor is expressed in `.nvmrc` + `engines`.
2. **Enforce at the boundary** — a root `preinstall` guard
   (`scripts/check-toolchain.mjs`) fails loud on the wrong package manager or the
   wrong pnpm major, with corepack instructions. CI reads the pnpm version from
   `packageManager` (no second source of truth).
3. **Update deliberately** — `.github/dependabot.yml` opens reviewed update PRs
   (grouped minor/patch, individual majors) that must pass the full CI gate
   before merge. No auto-chasing "latest" in place.

### Calibration (deliberately not over-governed)

Enforce hard only what bites silently and late; stay advisory where strictness
would break real installs for no benefit:

- **package manager / pnpm major** → fatal (this is what broke CI).
- **Node major** → warning only, and only below the `.nvmrc` floor. EAS Build
  pins no Node version and local dev may run a newer major; a hard check would
  break working installs. (We rejected pnpm `engine-strict=true` for the same
  reason — it hard-fails on transitive deps' `engines` ranges.)

A rule whose (prevented-cost × frequency) is less than its (maintenance +
friction) cost should be removed, not kept for completeness.

## Consequences

- `npm install` / `yarn` / a wrong pnpm major now fail immediately with a fix
  hint, instead of producing a lockfile CI rejects three steps later.
- Adding a dependency with a postinstall/native build step requires adding it to
  `pnpm.onlyBuiltDependencies` (pnpm 10 blocks build scripts by default).
- Bumping pnpm/Node is a visible, reviewed change (edit `packageManager`/`.nvmrc`
  → Dependabot or a manual PR → CI verifies), never an implicit drift.

## The reliability ladder (why this shape)

Push every concern as high up this ladder as possible; "just document it" is the
weakest rung and is where this incident lived:

1. Make invalid states impossible (types, pins, schemas)
2. Fail fast & loud at the boundary (this guard, CI gates)
3. Make it visible (this ADR)
4. Remember it (docs / agent memory) — decays, last resort
