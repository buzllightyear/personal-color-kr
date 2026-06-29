"""Parse supersession / parking markers from a source doc (pure)."""
from __future__ import annotations

import re

from scripts.drift_check.models import Marker, Target

_KEYWORDS = ("SUPERSEDED", "정정", "파킹")
_DATE_RE = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")
_WIKILINK_RE = re.compile(r"\[\[([^\]]+)\]\]")
# doc filenames we treat as propagation targets (cross-file org-brain docs)
_FILENAME_RE = re.compile(r"([A-Za-z0-9_-]+\.md)")
_SELF_DOC = "STRATEGY.md"


def _extract_targets(line: str) -> tuple[Target, ...]:
    targets: list[Target] = []
    seen: set[str] = set()
    for name in _WIKILINK_RE.findall(line):
        raw = f"[[{name}]]"
        if raw not in seen:
            seen.add(raw)
            targets.append(Target(raw=raw, source_syntax="wikilink", canonical_path=None, section_id=None))
    # strip wikilink spans first so a wikilink's inner ``.md`` isn't re-captured as a filename
    line_wo_wikilinks = _WIKILINK_RE.sub(" ", line)
    for fname in _FILENAME_RE.findall(line_wo_wikilinks):
        if fname == _SELF_DOC or fname in seen:
            continue  # cross-file only; skip self-reference
        seen.add(fname)
        targets.append(Target(raw=fname, source_syntax="filename", canonical_path=None, section_id=None))
    return tuple(targets)


def parse_markers(doc_text: str, doc_label: str) -> list[Marker]:
    """Return every supersession/parking marker in *doc_text*.

    A marker is any single line containing one of :data:`_KEYWORDS`. The line
    is captured verbatim as ``raw_text``; ``date`` is the first ``YYYY-MM-DD``
    on the line (or ``None``); ``targets`` are the cross-file doc references on
    the line (wikilinks + ``*.md`` filenames, excluding ``STRATEGY.md`` self-refs).
    """
    markers: list[Marker] = []
    for lineno, line in enumerate(doc_text.splitlines(), start=1):
        keyword = next((kw for kw in _KEYWORDS if kw in line), None)
        if keyword is None:
            continue
        date_match = _DATE_RE.search(line)
        markers.append(
            Marker(
                location=f"{doc_label}:{lineno}",
                keyword=keyword,
                date=date_match.group(1) if date_match else None,
                raw_text=line.strip(),
                targets=_extract_targets(line),
            )
        )
    return markers
