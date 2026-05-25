"""Unit tests for the Alembic *runtime* history chain (Phase 4.2 Sub-AC 1).

These tests complement ``test_alembic_baseline_revision.py`` by asserting
the chain topology through alembic's own
:class:`alembic.script.ScriptDirectory` API — the exact machinery the
``alembic history`` CLI walks under the hood. Where the AST-based tests
in ``test_alembic_baseline_revision.py`` verify the *source files* are
syntactically pinned (down_revision constant on the right RHS), this
module verifies that *alembic itself* loads those files and produces a
single, contiguous chain rooted at ``phase_4_1_baseline`` with the events
migration on top.

Acceptance criterion covered
----------------------------
Phase 4.2 Sub-AC 1: "Create alembic revision file with
``down_revision='phase_4_1_baseline'`` and verify via test that alembic
history shows correct chain on top of baseline."

Two separate guarantees compose to satisfy that AC:

    1. **Head + base identity** — alembic reports a single head
       (``phase_4_2_events``) and a single base (``phase_4_1_baseline``),
       proving the chain is linear (no branches) and rooted at the
       baseline.
    2. **Walk order** — :meth:`ScriptDirectory.walk_revisions` yields
       exactly the two expected revisions in head-to-base order, with
       the events migration's ``down_revision`` resolving to the
       baseline's revision id at the alembic-runtime layer.

Why ``ScriptDirectory`` instead of ``subprocess.run("alembic history")``?
------------------------------------------------------------------------
The ScriptDirectory API:

    * Is the **same code path** the alembic CLI uses to render
      ``alembic history`` — it parses the same files, builds the same
      DAG, and reports the same head/base/down_revision values.
    * Does **not** require a live Postgres connection (the
      ``sqlalchemy.url`` value in ``alembic.ini`` is intentionally
      blank), so this test stays in the unit tier rather than the
      integration tier — it runs in milliseconds during fast CI.
    * Returns structured Python objects (``Script`` instances) rather
      than CLI text that would need fragile string parsing.

The integration-tier counterpart that exercises the *actual* CLI
invocation lives in ``tests/integration/test_alembic_upgrade_head.py``
and ``test_events_migration.py``; together with this unit test the chain
is verified end-to-end (static source files → alembic runtime → live DB
``alembic_version`` stamp).
"""

from __future__ import annotations

from pathlib import Path

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory

# ---------------------------------------------------------------------------
# Path + revision constants
# ---------------------------------------------------------------------------
# ``parents[2]`` from apps/api/tests/unit/test_alembic_history_chain.py
# resolves to apps/api/ regardless of pytest cwd, so the alembic Config
# construction always receives an absolute alembic.ini path.
_APPS_API_ROOT: Path = Path(__file__).resolve().parents[2]
_ALEMBIC_INI_PATH: Path = _APPS_API_ROOT / "alembic.ini"

# Single source of truth for the three Phase 4.x revision ids. Mirroring
# the same literals used by ``test_alembic_baseline_revision.py`` so a
# rename anywhere in the chain breaks both the AST check and the
# alembic-runtime check in the same commit.
_BASELINE_REVISION_ID: str = "phase_4_1_baseline"
_EVENTS_REVISION_ID: str = "phase_4_2_events"
_USERS_REVISION_ID: str = "phase_4_3_users"


def _load_script_directory() -> ScriptDirectory:
    """Build a :class:`ScriptDirectory` from the apps/api alembic.ini.

    ``ScriptDirectory.from_config`` parses ``alembic.ini`` for the
    ``script_location`` option, walks the ``versions/`` directory, and
    builds an in-memory DAG of every revision it finds — the same DAG
    the alembic CLI walks for ``alembic history``, ``alembic heads``,
    ``alembic current``, etc.

    Centralizing the construction in a helper keeps every assertion in
    this module reading the chain through one canonical entry point.
    """
    cfg = Config(str(_ALEMBIC_INI_PATH))
    return ScriptDirectory.from_config(cfg)


@pytest.mark.unit
def test_alembic_history_reports_single_head_at_events_revision() -> None:
    """``alembic heads`` (via ScriptDirectory) returns exactly ``phase_4_2_events``.

    A single head proves the chain is **linear** — no accidental
    branching introduced by a sibling migration that forgot to chain on
    the existing head. The head's identity (``phase_4_2_events``) proves
    the events migration has been correctly registered with alembic and
    has taken over the head position from the Phase 4.1 baseline.
    """
    script = _load_script_directory()

    # ``ScriptDirectory.get_heads()`` returns a ``list[str]`` (alembic
    # internal type — see ``alembic/script/base.py``). We coerce to a
    # ``tuple`` for the equality assertion so the message reads naturally
    # regardless of the concrete container type alembic chose.
    heads = tuple(script.get_heads())
    assert heads == (_USERS_REVISION_ID,), (
        f"alembic must report exactly one head and it must be "
        f"{_USERS_REVISION_ID!r} (the Phase 4.3 users migration); "
        f"got {heads!r}. More than one head indicates the migration "
        f"chain branched (e.g. two migrations both set "
        f"``down_revision = 'phase_4_2_events'`` without merging); a "
        f"different head indicates a Phase 4.4+ migration sneaked in "
        f"prematurely."
    )


@pytest.mark.unit
def test_alembic_history_reports_single_base_at_baseline_revision() -> None:
    """``alembic bases`` (via ScriptDirectory) returns exactly ``phase_4_1_baseline``.

    The base set is the mirror image of the head set: a single base
    proves the chain has exactly one root, and the root's identity
    proves the Phase 4.1 baseline migration is still acting as the
    chain root (down_revision = None). Any future migration that
    accidentally sets ``down_revision = None`` would surface as a
    second base here.
    """
    script = _load_script_directory()

    # Same container-shape coercion as the head test above — alembic
    # returns a ``list[str]`` from ``get_bases()``.
    bases = tuple(script.get_bases())
    assert bases == (_BASELINE_REVISION_ID,), (
        f"alembic must report exactly one base and it must be "
        f"{_BASELINE_REVISION_ID!r} (the Phase 4.1 baseline migration); "
        f"got {bases!r}. More than one base indicates a second chain "
        f"root was introduced (a migration accidentally set "
        f"``down_revision = None``); a different base indicates the "
        f"baseline migration was renamed or removed without updating "
        f"the rest of the chain."
    )


@pytest.mark.unit
def test_alembic_walk_revisions_yields_chain_head_to_base_in_order() -> None:
    """``walk_revisions()`` yields events → baseline with correct down_revision.

    This is the strongest form of the chain assertion — it asks alembic
    to walk the DAG from head to base and verifies:

        * exactly two revisions appear in the walk
          (no extra revisions, no missing revisions),
        * the head-to-base order is ``phase_4_2_events`` then
          ``phase_4_1_baseline`` (proves the events migration sits
          *above* the baseline, not beside it),
        * the events migration's ``down_revision`` resolves to
          ``phase_4_1_baseline`` at the alembic-runtime layer (proves
          the chain link is honored by alembic itself, not just by the
          source-file AST),
        * the baseline migration's ``down_revision`` is ``None``
          (proves the baseline is still the chain root after Phase 4.2
          extended the chain on top of it).
    """
    script = _load_script_directory()

    # ``walk_revisions()`` returns an iterator of Script objects from
    # head down to base (alembic's own convention — see
    # ``alembic/script/base.py``). Materialize into a list so we can
    # index + count.
    walk = list(script.walk_revisions())

    assert len(walk) == 3, (
        f"alembic chain must contain exactly three revisions in Phase 4.3 "
        f"(baseline + events + users); walk_revisions() yielded {len(walk)}: "
        f"{[r.revision for r in walk]!r}. A fourth revision indicates an "
        f"orphan or Phase 4.4+ migration landed prematurely; fewer "
        f"revisions indicate a missing chain link."
    )

    head_script, events_script, base_script = walk

    # ---- Head position: the users migration sits on top.
    assert head_script.revision == _USERS_REVISION_ID, (
        f"The head of walk_revisions() must be {_USERS_REVISION_ID!r} "
        f"(the users migration); got {head_script.revision!r}. The "
        f"walk order is head-to-base, so the first element is the head."
    )

    # ---- Users migration chains on the events migration.
    assert head_script.down_revision == _EVENTS_REVISION_ID, (
        f"Users migration's down_revision must equal "
        f"{_EVENTS_REVISION_ID!r}; got {head_script.down_revision!r}."
    )

    # ---- Events migration chains on the baseline (Phase 4.2 invariant).
    assert events_script.revision == _EVENTS_REVISION_ID, (
        f"Middle script in walk must be {_EVENTS_REVISION_ID!r}; "
        f"got {events_script.revision!r}."
    )
    assert events_script.down_revision == _BASELINE_REVISION_ID, (
        f"Events migration's down_revision must equal "
        f"{_BASELINE_REVISION_ID!r}; got {events_script.down_revision!r}."
    )

    # ---- Base position: the baseline migration is still the root.
    assert base_script.revision == _BASELINE_REVISION_ID, (
        f"The base of walk_revisions() must be {_BASELINE_REVISION_ID!r} "
        f"(the Phase 4.1 baseline migration); got {base_script.revision!r}."
    )

    # ---- Baseline migration is still the chain root (down_revision is None).
    assert base_script.down_revision is None, (
        f"Baseline migration's down_revision must remain ``None`` at "
        f"the alembic-runtime layer (chain root invariant); got "
        f"{base_script.down_revision!r}. A non-None value indicates a "
        f"Phase 4.3+ migration accidentally became the new chain root."
    )
