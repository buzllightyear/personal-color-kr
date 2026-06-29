"""Pure version-specifier parsing + intersection satisfiability (no I/O). [Phase 2 D4]"""

from __future__ import annotations

import re

Clause = tuple[str, tuple[int, ...]]

# supported operators only; `< <= > >= ==`. `!= ~= ===` etc. → parse returns None.
_CLAUSE_RE = re.compile(r"^(<=|>=|==|<|>)\s*([0-9]+(?:\.[0-9]+)*)$")


def parse_specifier(spec: str) -> list[Clause] | None:
    """Parse a PEP440-ish specifier into clauses, or None if any clause uses an
    unsupported operator / is unparseable. Empty string → [] (no constraint)."""
    spec = spec.strip()
    if not spec:
        return []
    clauses: list[Clause] = []
    for part in spec.split(","):
        m = _CLAUSE_RE.match(part.strip())
        if m is None:
            return None
        clauses.append((m.group(1), tuple(int(x) for x in m.group(2).split("."))))
    return clauses


def _pad(
    a: tuple[int, ...], b: tuple[int, ...]
) -> tuple[tuple[int, ...], tuple[int, ...]]:
    """Right-pad the shorter tuple with zeros so 9.1 and 9.1.0 compare equal."""
    n = max(len(a), len(b))
    return a + (0,) * (n - len(a)), b + (0,) * (n - len(b))


def _lt(a: tuple[int, ...], b: tuple[int, ...]) -> bool:
    pa, pb = _pad(a, b)
    return pa < pb


def _eq(a: tuple[int, ...], b: tuple[int, ...]) -> bool:
    pa, pb = _pad(a, b)
    return pa == pb


def is_satisfiable(clauses: list[Clause]) -> bool:
    """True iff some version satisfies every clause (intersection non-empty).

    Collapses clauses into a single interval: the tightest lower bound (max of
    `>=`/`>`/`==` versions) and tightest upper bound (min of `<=`/`<`/`==`).
    Feasible iff lo < hi, or lo == hi with both bounds inclusive (a single point).
    """
    lowers: list[tuple[tuple[int, ...], bool]] = []  # (version, inclusive)
    uppers: list[tuple[tuple[int, ...], bool]] = []
    for op, v in clauses:
        if op == ">=":
            lowers.append((v, True))
        elif op == ">":
            lowers.append((v, False))
        elif op == "<=":
            uppers.append((v, True))
        elif op == "<":
            uppers.append((v, False))
        elif op == "==":
            lowers.append((v, True))
            uppers.append((v, True))
    if not lowers or not uppers:
        return True  # open on at least one side → always some version
    lo_v = max(v for v, _ in lowers)
    lo_incl = all(incl for v, incl in lowers if _eq(v, lo_v))
    hi_v = min(v for v, _ in uppers)
    hi_incl = all(incl for v, incl in uppers if _eq(v, hi_v))
    if _lt(lo_v, hi_v):
        return True
    if _eq(lo_v, hi_v):
        return lo_incl and hi_incl
    return False
