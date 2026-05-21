"""Scan-option selection state handler (Sub-AC 5.2).

Ontology concept (Seed): ``scan_option_ui`` — Step 6 (`scan_option_select`) of
the 12-step funnel renders 3 CTA cards. This module owns the *runtime
selection state* sitting in front of the immutable catalogue.

Why a stateful handler exists alongside the immutable catalogue:

    - ``src/scan_option/options.py`` is the **immutable** source of truth for
      *which* options exist (id, slot, role, status, label).
    - The funnel UI needs to track *which option the user has tapped* so
      Step 7 (`fake_loader`) and the diagnosis orchestrator can branch on it.
    - The Python side needs an in-memory state-bag the diagnosis pipeline
      can query (`get_selected()`).

Design:

    - The handler validates every selection against the canonical catalogue
      — passing an unknown id raises ``UnknownScanOptionError``.
    - Re-selection is allowed (a user can change their mind on Step 6 until
      they tap "다음"). Each ``select()`` call overwrites the prior selection
      without raising.
    - ``reset()`` returns the handler to the *initial state* (no selection)
      so a session can be restarted without re-instantiating.
    - The catalogue itself is **never** mutated — we look options up by id
      and return the frozen ``ScanOption`` record from the catalogue
      singleton. The handler holds only the selected id (or ``None``).

Seed constraints honoured:

    - 퍼스널 컬러 진단 = hook only. Selecting any non-PERSONAL_COLOR option
      is still allowed at the catalogue level (slots 2/3 exist as
      placeholders), but those options carry ``status == PHASE_N_TBD`` and
      ``placeholder is True``; UI code can branch on those flags to render
      a "곧 오픈" toast instead of advancing the funnel.
    - The handler does not introduce any new option ids. It validates
      against ``get_available_options()`` exclusively, so drift between
      catalogue and handler is impossible by construction.
"""

from __future__ import annotations

from typing import Optional

from .options import (
    ScanOption,
    ScanOptionId,
    get_available_options,
)

# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class UnknownScanOptionError(ValueError):
    """Raised when ``select()`` is called with an id not in the catalogue.

    Attributes:
        attempted_id: The string id the caller tried to select.
        known_ids: The tuple of valid catalogue ids at the time of the call.
    """

    def __init__(
        self,
        attempted_id: str,
        known_ids: tuple[ScanOptionId, ...],
    ) -> None:
        self.attempted_id: str = attempted_id
        self.known_ids: tuple[ScanOptionId, ...] = known_ids
        known_csv = ", ".join(opt.value for opt in known_ids)
        super().__init__(
            f"Unknown scan option id {attempted_id!r}. " f"Known ids: [{known_csv}]",
        )


# ---------------------------------------------------------------------------
# Handler
# ---------------------------------------------------------------------------


class ScanOptionHandler:
    """In-memory selection state for the Step 6 scan-option chooser.

    Lifecycle:

        1. ``ScanOptionHandler()`` — initial state, no option selected.
        2. ``handler.select(option_id)`` — record the user's tap.
        3. ``handler.get_selected()`` — read back the chosen option (or
           ``None`` if the user hasn't tapped yet).
        4. ``handler.reset()`` — clear the selection (back to step 1).

    The handler is intentionally **not** a frozen dataclass — its whole job
    is to hold *mutable selection state*. The records it points at (entries
    in the catalogue) remain frozen; only the internal "currently selected
    id" pointer mutates.

    Thread-safety: this class is single-threaded by contract. Each user
    session owns its own handler instance; the funnel UI never shares one
    across requests. If we ever need multi-threaded access we'll wrap a
    lock around ``select``/``reset`` — but the Seed does not require it
    today.
    """

    def __init__(self) -> None:
        # Map id-string → frozen ScanOption record for O(1) lookup on select.
        # Built once at construction time from the immutable catalogue, so a
        # later mutation to ``options.py`` would still need a new handler
        # instance to take effect — which matches the "import-time validate"
        # contract the catalogue itself enforces.
        self._lookup: dict[ScanOptionId, ScanOption] = {
            opt.id: opt for opt in get_available_options()
        }
        self._selected_id: Optional[ScanOptionId] = None

    # -- queries -----------------------------------------------------------

    def get_selected(self) -> Optional[ScanOption]:
        """Return the currently-selected option, or ``None`` if none.

        The returned object is the same frozen ``ScanOption`` instance that
        lives in the catalogue singleton; callers must not attempt to mutate
        it (the ``@dataclass(frozen=True)`` would raise anyway).
        """
        if self._selected_id is None:
            return None
        return self._lookup[self._selected_id]

    def is_selected(self) -> bool:
        """Convenience predicate: ``True`` iff an option has been selected."""
        return self._selected_id is not None

    # -- mutations ---------------------------------------------------------

    def select(self, option_id: ScanOptionId | str) -> ScanOption:
        """Record a user's selection and return the chosen option.

        Accepts either a ``ScanOptionId`` enum value or the equivalent raw
        string — the UI layer often hands us the latter from a click event,
        and forcing every caller to coerce would be friction without value.

        Re-selection is allowed: calling ``select`` again silently replaces
        the previous choice. The Seed treats Step 6 as a single-pick screen
        where the user can change their mind until they advance.

        Args:
            option_id: The id of the option to select. Strings are accepted
                for convenience and coerced via ``ScanOptionId``.

        Returns:
            The frozen ``ScanOption`` record now stored as the selection.

        Raises:
            UnknownScanOptionError: if ``option_id`` is not present in the
                canonical catalogue.
        """
        coerced = self._coerce_id(option_id)
        if coerced not in self._lookup:
            raise UnknownScanOptionError(
                attempted_id=str(option_id),
                known_ids=tuple(self._lookup.keys()),
            )

        self._selected_id = coerced
        return self._lookup[coerced]

    def reset(self) -> None:
        """Clear the selection — handler returns to the initial state."""
        self._selected_id = None

    # -- internals ---------------------------------------------------------

    @staticmethod
    def _coerce_id(option_id: ScanOptionId | str) -> ScanOptionId:
        """Normalise the input to a ``ScanOptionId`` enum value.

        Raises ``UnknownScanOptionError`` if ``option_id`` is a string that
        doesn't match any catalogue id — this keeps the failure mode
        consistent regardless of whether the caller passed a typo'd string
        or an unrecognised enum-like object.
        """
        if isinstance(option_id, ScanOptionId):
            return option_id
        if isinstance(option_id, str):
            try:
                return ScanOptionId(option_id)
            except ValueError as exc:
                # Surface the canonical handler error, not the bare enum one,
                # so call sites can catch a single exception type.
                raise UnknownScanOptionError(
                    attempted_id=option_id,
                    known_ids=tuple(opt.id for opt in get_available_options()),
                ) from exc
        raise UnknownScanOptionError(
            attempted_id=repr(option_id),
            known_ids=tuple(opt.id for opt in get_available_options()),
        )
