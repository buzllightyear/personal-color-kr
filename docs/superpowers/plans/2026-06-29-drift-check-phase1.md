# Drift Check — Phase 1 (D1 supersession-전파) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** STRATEGY.md의 supersession/parking 마커가 명명한 cross-file 문서 타깃(CLAUDE.md·memory·ADR)이 그 변경을 *역참조(acknowledge)* 했는지 판별해 surfaced 리포트로 올리는, 결정론적·비차단 도구의 첫 슬라이스.

**Architecture:** 순수 파서(markers) → 타깃 해석(targets) → 역참조 판정(propagation) → 마크다운 리포트(report) → CLI(run). 네트워크·LLM·git 의존 없음(Phase 1은 *역참조 부재* 단일 신호만; git advisory와 PROPAGATION_STALE_CANDIDATE는 Phase 3로 유예). 모두 frozen dataclass + 순수함수라 fixture로 단위 검증.

**Tech Stack:** Python 3.12, 표준 라이브러리만(`re`, `pathlib`, `dataclasses`), pytest. 위치 `scripts/drift_check/`.

## Global Constraints

- **Surfaced only** — 절대 gate/block/auto-fix 안 함. 출력은 리포트뿐.
- **No new runtime LLM dependency** — Phase 1엔 AI 단계 없음(전부 결정론). 표준 라이브러리 외 신규 의존성 금지.
- **Plane 가드 (교정된 규칙):** D1은 *타깃이 cross-file 조직-brain 문서(CLAUDE.md / memory `.md` / `docs/decisions/*.md`)일 때만* finding 산출. marker의 주변 epistemic 태그(`[thesis]`/`[decision]`/`[external]`)로 거르지 **않는다** — 전파 마커는 그런 태그 아래 살아도 정당하다(예: §7-G는 `[decision]`이나 flagship 케이스). D1은 "타깃이 ack했나"만 보고 주장 *유효성*은 절대 판정 안 함(그건 J, [ground-truth] 전용). intra-STRATEGY 섹션 자기참조 타깃은 제외(cross-file만).
- **Code wins for current state** — 리포트는 "코드/문서 확인" human action만 제안. 코드 변경·문서를 코드보다 앞세우는 제안 금지.
- **Python 규약:** PEP8, 모든 함수 시그니처에 타입 주석, immutability = `@dataclass(frozen=True)`(새 객체 반환, 변이 금지), pytest.
- **Phase 1 한정 candidate states:** `PROPAGATED` / `PROPAGATION_MISSING` / `NEEDS_MANUAL_REVIEW`. (`PROPAGATION_STALE_CANDIDATE`는 git advisory 필요 → Phase 3.)

---

## File Structure

```
scripts/drift_check/
  __init__.py
  models.py            # frozen dataclasses: Target, Marker, Finding  (Task 1)
  markers.py           # parse_markers(doc_text, doc_label) -> list[Marker]  (Task 2)
  targets.py           # resolve(target, repo_root, memory_dir) -> Target    (Task 3)
  propagation.py       # evaluate(marker, repo_root, memory_dir) -> list[Finding]  (Task 4)
  report.py            # render(findings) -> str ; summary_line(findings) -> str  (Task 5)
  run.py               # CLI: STRATEGY.md -> report  (Task 6)
  tests/
    __init__.py
    fixtures/          # synthetic mini-docs (Task 7)
    test_markers.py    (Task 2)
    test_targets.py    (Task 3)
    test_propagation.py (Task 4)
    test_report.py     (Task 5)
    test_golden.py     (Task 7)
```

**Execution invariant (모든 step 명령에 적용):** *반드시 repo root(`/Users/opty/Code/personal-color-kr`)를 cwd로* 실행하고 인터프리터는 `python3`다 — 이 환경엔 `python` 실행파일이 없다(`python3`만 있음). `scripts/`엔 `__init__.py`가 **없다**(PEP 420 namespace package, 기존 `scripts/fal_eval/` 관례와 동일). `from scripts.drift_check.…` 임포트는 *repo root가 `sys.path`에 있을 때만* 해석되며 — 이는 repo root에서 `python3 -m pytest`를 돌릴 때(+ root `pytest.ini`의 `--import-mode=importlib`) 자동 충족된다. 하위 디렉토리에서 실행하면 `ModuleNotFoundError: No module named 'scripts'`로 깨진다. `scripts/__init__.py`를 추가하지 **말 것**(namespace package 관례 유지).

Run tests from repo root: `python3 -m pytest scripts/drift_check/tests/ -v`

---

### Task 1: 패키지 스캐폴드 + 데이터 모델

**Files:**
- Create: `scripts/drift_check/__init__.py` (빈 파일)
- Create: `scripts/drift_check/tests/__init__.py` (빈 파일)
- Create: `scripts/drift_check/models.py`
- Test: `scripts/drift_check/tests/test_models.py`

**Interfaces:**
- Produces: `Target(raw: str, source_syntax: str, canonical_path: str | None, section_id: str | None)`; `Marker(location: str, keyword: str, date: str | None, raw_text: str, targets: tuple[Target, ...])`; `Finding(marker_location: str, target_raw: str, target_path: str | None, state: str, evidence: str)`. 모두 `frozen=True`.

- [ ] **Step 1: Write the failing test**

```python
# scripts/drift_check/tests/test_models.py
import dataclasses
import pytest
from scripts.drift_check.models import Target, Marker, Finding


def test_models_are_frozen_dataclasses():
    t = Target(raw="CLAUDE.md", source_syntax="filename", canonical_path="CLAUDE.md", section_id=None)
    m = Marker(location="STRATEGY.md:28", keyword="SUPERSEDED", date="2026-06-28", raw_text="...", targets=(t,))
    f = Finding(marker_location="STRATEGY.md:28", target_raw="CLAUDE.md", target_path="CLAUDE.md",
                state="PROPAGATION_MISSING", evidence="no back-reference")
    # frozen → mutation raises
    with pytest.raises(dataclasses.FrozenInstanceError):
        t.raw = "x"  # type: ignore[misc]
    assert m.targets[0] is t
    assert f.state == "PROPAGATION_MISSING"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest scripts/drift_check/tests/test_models.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.drift_check.models'`

- [ ] **Step 3: Write minimal implementation**

```python
# scripts/drift_check/models.py
"""Frozen value objects for the drift-check tool (Phase 1)."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Target:
    """A doc named by a supersession marker as needing the change propagated."""

    raw: str                      # as written, e.g. "[[app-identity-decision]]" or "CLAUDE.md"
    source_syntax: str            # "wikilink" | "filename"  (Phase 1 생성값; ADR 경로-한정 참조는 미지원 — 알려진 제약)
    canonical_path: str | None    # resolved path (repo-relative or absolute); None if unresolvable
    section_id: str | None        # e.g. "§7-B"; None when the marker names no section


@dataclass(frozen=True)
class Marker:
    """A supersession / parking note found in a source doc."""

    location: str                 # "STRATEGY.md:<line>"
    keyword: str                  # "SUPERSEDED" | "정정" | "파킹"
    date: str | None              # "YYYY-MM-DD" or None
    raw_text: str                 # captured marker block
    targets: tuple[Target, ...]


@dataclass(frozen=True)
class Finding:
    """One (marker, target) propagation verdict candidate."""

    marker_location: str
    target_raw: str
    target_path: str | None
    state: str                    # "PROPAGATED" | "PROPAGATION_MISSING" | "NEEDS_MANUAL_REVIEW"
    evidence: str
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest scripts/drift_check/tests/test_models.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/drift_check/__init__.py scripts/drift_check/tests/__init__.py scripts/drift_check/models.py scripts/drift_check/tests/test_models.py
git commit -m "feat(drift-check): scaffold package + frozen data models"
```

---

### Task 2: 마커 파서 (`markers.py`)

**Files:**
- Create: `scripts/drift_check/markers.py`
- Test: `scripts/drift_check/tests/test_markers.py`

**Interfaces:**
- Consumes: `Target`, `Marker` from `models`.
- Produces: `parse_markers(doc_text: str, doc_label: str) -> list[Marker]`. Markers는 키워드(`SUPERSEDED`|`정정`|`파킹`) 포함 줄에서 시작, 줄 끝까지를 `raw_text`로 캡처. `date` = 같은 줄 첫 `YYYY-MM-DD`(없으면 None). `targets` = 같은 줄에서 추출한 `[[wikilink]]`(syntax="wikilink")·문서 파일명 `CLAUDE.md`(syntax="filename"). **`STRATEGY.md` 자기참조는 타깃에서 제외**(cross-file만). 이 단계에선 `canonical_path=None`(해석은 Task 3).

- [ ] **Step 1: Write the failing test**

```python
# scripts/drift_check/tests/test_markers.py
from scripts.drift_check.markers import parse_markers


def test_parses_superseded_marker_with_filename_and_wikilink_targets():
    doc = (
        "intro line\n"
        "> **⚠ SUPERSEDED (2026-06-28):** see **CLAUDE.md** and [[app-identity-decision]] need update.\n"
        "trailing line\n"
    )
    markers = parse_markers(doc, "STRATEGY.md")
    assert len(markers) == 1
    m = markers[0]
    assert m.keyword == "SUPERSEDED"
    assert m.date == "2026-06-28"
    assert m.location == "STRATEGY.md:2"
    raws = sorted(t.raw for t in m.targets)
    assert raws == ["CLAUDE.md", "[[app-identity-decision]]"]
    assert {t.source_syntax for t in m.targets} == {"filename", "wikilink"}


def test_excludes_strategy_self_reference_target():
    doc = "> **정정 (2026-06-29):** STRATEGY.md §2 도 보라; CLAUDE.md 갱신.\n"
    markers = parse_markers(doc, "STRATEGY.md")
    assert len(markers) == 1
    raws = [t.raw for t in markers[0].targets]
    assert "CLAUDE.md" in raws
    assert "STRATEGY.md" not in raws  # cross-file only


def test_no_marker_returns_empty():
    assert parse_markers("just a normal paragraph with no keyword\n", "STRATEGY.md") == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest scripts/drift_check/tests/test_markers.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.drift_check.markers'`

- [ ] **Step 3: Write minimal implementation**

```python
# scripts/drift_check/markers.py
"""Parse supersession / parking markers from a source doc (pure)."""
from __future__ import annotations

import re

from scripts.drift_check.models import Marker, Target

_KEYWORDS = ("SUPERSEDED", "정정", "파킹")
_DATE_RE = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")
_WIKILINK_RE = re.compile(r"\[\[([^\]]+)\]\]")
# doc filenames we treat as propagation targets (cross-file org-brain docs)
_FILENAME_RE = re.compile(r"\b([A-Za-z0-9_-]+\.md)\b")
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest scripts/drift_check/tests/test_markers.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/drift_check/markers.py scripts/drift_check/tests/test_markers.py
git commit -m "feat(drift-check): parse supersession markers + cross-file targets"
```

---

### Task 3: 타깃 해석 (`targets.py`)

**Files:**
- Create: `scripts/drift_check/targets.py`
- Test: `scripts/drift_check/tests/test_targets.py`

**Interfaces:**
- Consumes: `Target` from `models`.
- Produces: `resolve(target: Target, repo_root: Path, memory_dir: Path) -> Target`. 새 frozen `Target`(canonical_path 채움) 반환. 규칙: `source_syntax=="filename"` → `repo_root/<raw>` 존재 시 repo-relative 경로; `source_syntax=="wikilink"` → `memory_dir/<slug>.md` 존재 시 절대경로(⚠ memory는 repo 밖 = tree 넘는 유일 지점); 존재 안 하면 `canonical_path=None`(→ Task 4가 NEEDS_MANUAL_REVIEW).
- Produces: `default_memory_dir(repo_root: Path) -> Path` — repo 경로에서 auto-memory 디렉토리 파생(`~/.claude/projects/<sanitized-abs-repo-path>/memory`, 경로 구분자 `-` 치환).

- [ ] **Step 1: Write the failing test**

```python
# scripts/drift_check/tests/test_targets.py
from pathlib import Path
from scripts.drift_check.models import Target
from scripts.drift_check.targets import resolve, default_memory_dir


def _t(raw: str, syntax: str) -> Target:
    return Target(raw=raw, source_syntax=syntax, canonical_path=None, section_id=None)


def test_resolves_existing_filename_to_repo_relative(tmp_path: Path):
    (tmp_path / "CLAUDE.md").write_text("x", encoding="utf-8")
    out = resolve(_t("CLAUDE.md", "filename"), repo_root=tmp_path, memory_dir=tmp_path / "mem")
    assert out.canonical_path == "CLAUDE.md"


def test_resolves_existing_wikilink_to_memory_file(tmp_path: Path):
    mem = tmp_path / "mem"
    mem.mkdir()
    (mem / "app-identity-decision.md").write_text("x", encoding="utf-8")
    out = resolve(_t("[[app-identity-decision]]", "wikilink"), repo_root=tmp_path, memory_dir=mem)
    assert out.canonical_path == str(mem / "app-identity-decision.md")


def test_unresolvable_target_yields_none(tmp_path: Path):
    out = resolve(_t("[[ghost-note]]", "wikilink"), repo_root=tmp_path, memory_dir=tmp_path / "mem")
    assert out.canonical_path is None


def test_default_memory_dir_derives_from_repo_path():
    d = default_memory_dir(Path("/Users/opty/Code/personal-color-kr"))
    assert d.name == "memory"
    assert "-Users-opty-Code-personal-color-kr" in str(d)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest scripts/drift_check/tests/test_targets.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.drift_check.targets'`

- [ ] **Step 3: Write minimal implementation**

```python
# scripts/drift_check/targets.py
"""Resolve a marker Target to a canonical file path (pure-ish: reads fs existence)."""
from __future__ import annotations

import dataclasses
from pathlib import Path

from scripts.drift_check.models import Target


def default_memory_dir(repo_root: Path) -> Path:
    """Derive the project auto-memory dir from the repo's absolute path.

    Mirrors the harness convention: ``~/.claude/projects/<abs-path-with-/-as->/memory``.
    """
    abs_path = repo_root.resolve()
    sanitized = str(abs_path).replace("/", "-")
    return Path.home() / ".claude" / "projects" / sanitized / "memory"


def resolve(target: Target, repo_root: Path, memory_dir: Path) -> Target:
    """Return a new Target with ``canonical_path`` filled (or None if unresolvable)."""
    canonical: str | None = None
    if target.source_syntax == "filename":
        candidate = repo_root / target.raw
        if candidate.is_file():
            canonical = target.raw  # repo-relative
    elif target.source_syntax == "wikilink":
        slug = target.raw.strip("[]")
        candidate = memory_dir / f"{slug}.md"
        if candidate.is_file():
            canonical = str(candidate)  # absolute; memory lives outside the repo tree
    return dataclasses.replace(target, canonical_path=canonical)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest scripts/drift_check/tests/test_targets.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/drift_check/targets.py scripts/drift_check/tests/test_targets.py
git commit -m "feat(drift-check): resolve marker targets to canonical paths"
```

---

### Task 4: 역참조 판정 (`propagation.py`)

**Files:**
- Create: `scripts/drift_check/propagation.py`
- Test: `scripts/drift_check/tests/test_propagation.py`

**Interfaces:**
- Consumes: `Marker`, `Target`, `Finding` from `models`; `resolve` from `targets`.
- Produces: `evaluate(marker: Marker, repo_root: Path, memory_dir: Path, source_doc_label: str = "STRATEGY") -> list[Finding]`. 각 타깃마다 resolve → 해석불가면 `NEEDS_MANUAL_REVIEW`; 해석되면 타깃 파일 텍스트를 읽어 `has_backreference(text, source_doc_label)` → True면 `PROPAGATED`, False면 `PROPAGATION_MISSING`.
- Produces: `has_backreference(target_text: str, source_doc_label: str) -> bool` — 타깃 본문이 source 문서를 언급하면(대소문자 무시 substring, 예 "STRATEGY") True. *역참조 존재 = Phase 1에선 propagated로 간주; 잔존 superseded 문구 재확인은 J/Phase 3로 유예(스펙 §4 D1 판정규칙).*

- [ ] **Step 1: Write the failing test**

```python
# scripts/drift_check/tests/test_propagation.py
from pathlib import Path
from scripts.drift_check.models import Marker, Target
from scripts.drift_check.propagation import evaluate, has_backreference


def test_has_backreference_substring_case_insensitive():
    assert has_backreference("see docs/strategy.md for the trajectory", "STRATEGY")
    assert not has_backreference("unrelated note", "STRATEGY")


def _marker(target: Target) -> Marker:
    return Marker(location="STRATEGY.md:5", keyword="SUPERSEDED", date="2026-06-28",
                  raw_text="...", targets=(target,))


def test_target_with_backref_is_propagated(tmp_path: Path):
    (tmp_path / "CLAUDE.md").write_text("Direction: see STRATEGY.md §7.", encoding="utf-8")
    t = Target(raw="CLAUDE.md", source_syntax="filename", canonical_path=None, section_id=None)
    findings = evaluate(_marker(t), repo_root=tmp_path, memory_dir=tmp_path / "mem")
    assert [f.state for f in findings] == ["PROPAGATED"]


def test_target_without_backref_is_missing(tmp_path: Path):
    (tmp_path / "CLAUDE.md").write_text("nothing relevant here.", encoding="utf-8")
    t = Target(raw="CLAUDE.md", source_syntax="filename", canonical_path=None, section_id=None)
    findings = evaluate(_marker(t), repo_root=tmp_path, memory_dir=tmp_path / "mem")
    assert [f.state for f in findings] == ["PROPAGATION_MISSING"]


def test_unresolvable_target_needs_manual_review(tmp_path: Path):
    t = Target(raw="[[ghost]]", source_syntax="wikilink", canonical_path=None, section_id=None)
    findings = evaluate(_marker(t), repo_root=tmp_path, memory_dir=tmp_path / "mem")
    assert [f.state for f in findings] == ["NEEDS_MANUAL_REVIEW"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest scripts/drift_check/tests/test_propagation.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.drift_check.propagation'`

- [ ] **Step 3: Write minimal implementation**

```python
# scripts/drift_check/propagation.py
"""D1: decide whether each marker target acknowledges the supersession (pure-ish)."""
from __future__ import annotations

from pathlib import Path

from scripts.drift_check.models import Finding, Marker
from scripts.drift_check.targets import resolve


def has_backreference(target_text: str, source_doc_label: str) -> bool:
    """True iff the target doc mentions the source doc (primary propagation signal).

    Phase 1 treats any back-reference as 'propagated'. Detecting a back-reference
    that sits next to *stale* superseded prose is deferred to the J stage (spec §4
    D1 판정규칙) — Phase 1 never asserts VALID, only the candidate states.
    """
    return source_doc_label.lower() in target_text.lower()


def evaluate(
    marker: Marker,
    repo_root: Path,
    memory_dir: Path,
    source_doc_label: str = "STRATEGY",
) -> list[Finding]:
    """Return one Finding per marker target."""
    findings: list[Finding] = []
    for target in marker.targets:
        resolved = resolve(target, repo_root=repo_root, memory_dir=memory_dir)
        if resolved.canonical_path is None:
            findings.append(
                Finding(
                    marker_location=marker.location,
                    target_raw=target.raw,
                    target_path=None,
                    state="NEEDS_MANUAL_REVIEW",
                    evidence=f"target '{target.raw}' could not be resolved to a file",
                )
            )
            continue
        path = (
            repo_root / resolved.canonical_path
            if not Path(resolved.canonical_path).is_absolute()
            else Path(resolved.canonical_path)
        )
        text = path.read_text(encoding="utf-8")
        if has_backreference(text, source_doc_label):
            state, evidence = "PROPAGATED", f"'{source_doc_label}' referenced in target"
        else:
            state, evidence = "PROPAGATION_MISSING", f"no '{source_doc_label}' reference in target"
        findings.append(
            Finding(
                marker_location=marker.location,
                target_raw=target.raw,
                target_path=resolved.canonical_path,
                state=state,
                evidence=evidence,
            )
        )
    return findings
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest scripts/drift_check/tests/test_propagation.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/drift_check/propagation.py scripts/drift_check/tests/test_propagation.py
git commit -m "feat(drift-check): D1 back-reference propagation verdict"
```

---

### Task 5: 리포트 렌더 (`report.py`)

**Files:**
- Create: `scripts/drift_check/report.py`
- Test: `scripts/drift_check/tests/test_report.py`

**Interfaces:**
- Consumes: `Finding` from `models`.
- Produces: `summary_line(findings: list[Finding]) -> str` — 예 `"1 PROPAGATED, 1 PROPAGATION_MISSING, 0 NEEDS_MANUAL_REVIEW"`. `render(findings: list[Finding]) -> str` — 마크다운: 제목 + surfaced/code-wins 고지 + 표(`marker → target → state → evidence`) + 끝 요약줄. (human action 컬럼 = "코드/문서 확인" 류 제안만; 코드 변경 제안 금지.)

- [ ] **Step 1: Write the failing test**

```python
# scripts/drift_check/tests/test_report.py
from scripts.drift_check.models import Finding
from scripts.drift_check.report import render, summary_line


def _f(state: str) -> Finding:
    return Finding(marker_location="STRATEGY.md:5", target_raw="CLAUDE.md",
                   target_path="CLAUDE.md", state=state, evidence="ev")


def test_summary_line_counts_states():
    out = summary_line([_f("PROPAGATED"), _f("PROPAGATION_MISSING"), _f("PROPAGATION_MISSING")])
    assert out == "1 PROPAGATED, 2 PROPAGATION_MISSING, 0 NEEDS_MANUAL_REVIEW"


def test_render_is_markdown_with_states_and_surfaced_notice():
    md = render([_f("PROPAGATION_MISSING")])
    assert md.startswith("# Drift Report")
    assert "surfaced" in md.lower()
    assert "PROPAGATION_MISSING" in md
    assert "STRATEGY.md:5" in md
    # code-wins guard: never proposes code edits
    assert "코드 변경" not in md
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest scripts/drift_check/tests/test_report.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.drift_check.report'`

- [ ] **Step 3: Write minimal implementation**

```python
# scripts/drift_check/report.py
"""Render D1 findings to a surfaced markdown report (pure)."""
from __future__ import annotations

from scripts.drift_check.models import Finding

_STATES = ("PROPAGATED", "PROPAGATION_MISSING", "NEEDS_MANUAL_REVIEW")
_ACTION = {
    "PROPAGATED": "—",
    "PROPAGATION_MISSING": "타깃 문서에 STRATEGY 변경 반영(역참조 추가)했는지 확인",
    "NEEDS_MANUAL_REVIEW": "타깃 수동 확인(해석 불가)",
}


def summary_line(findings: list[Finding]) -> str:
    counts = {s: sum(1 for f in findings if f.state == s) for s in _STATES}
    return ", ".join(f"{counts[s]} {s}" for s in _STATES)


def render(findings: list[Finding]) -> str:
    lines = [
        "# Drift Report — D1 supersession-전파 (surfaced)",
        "",
        "> surfaced·비차단. *Code wins for current state* — 아래 human action은 문서 확인/전파만 제안하며 코드를 바꾸지 않는다.",
        "",
        "| marker | target | state | evidence | human action |",
        "|---|---|---|---|---|",
    ]
    for f in findings:
        lines.append(
            f"| {f.marker_location} | {f.target_raw} | {f.state} | {f.evidence} | {_ACTION[f.state]} |"
        )
    lines += ["", f"**Summary:** {summary_line(findings)}"]
    return "\n".join(lines)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest scripts/drift_check/tests/test_report.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/drift_check/report.py scripts/drift_check/tests/test_report.py
git commit -m "feat(drift-check): surfaced markdown report renderer"
```

---

### Task 6: CLI 오케스트레이션 (`run.py`)

**Files:**
- Create: `scripts/drift_check/run.py`
- Test: `scripts/drift_check/tests/test_run.py`

**Interfaces:**
- Consumes: `parse_markers` (markers), `evaluate` (propagation), `render`/`summary_line` (report), `default_memory_dir` (targets).
- Produces: `run_check(repo_root: Path, memory_dir: Path | None = None) -> tuple[str, list[Finding]]` — STRATEGY.md 읽고 → 마커 파싱 → 각 마커 evaluate → (markdown, findings) 반환. `main(argv: list[str] | None = None) -> int` — `--repo-root`(기본 cwd), `--out`(기본 `docs/drift-report.md`) 옵션; 리포트 파일 쓰고 요약줄 stdout print; 항상 exit 0(surfaced·non-blocking).

- [ ] **Step 1: Write the failing test**

```python
# scripts/drift_check/tests/test_run.py
from pathlib import Path
from scripts.drift_check.run import run_check, main


def _seed_repo(root: Path, claude_body: str) -> None:
    (root / "docs").mkdir(parents=True, exist_ok=True)
    (root / "docs" / "STRATEGY.md").write_text(
        "> **⚠ SUPERSEDED (2026-06-28):** CLAUDE.md needs update.\n", encoding="utf-8"
    )
    (root / "CLAUDE.md").write_text(claude_body, encoding="utf-8")


def test_run_check_flags_missing_propagation(tmp_path: Path):
    _seed_repo(tmp_path, claude_body="no reference here")
    md, findings = run_check(repo_root=tmp_path, memory_dir=tmp_path / "mem")
    assert [f.state for f in findings] == ["PROPAGATION_MISSING"]
    assert "PROPAGATION_MISSING" in md


def test_main_writes_report_and_exits_zero(tmp_path: Path):
    _seed_repo(tmp_path, claude_body="see STRATEGY.md §7")
    out = tmp_path / "docs" / "drift-report.md"
    code = main(["--repo-root", str(tmp_path), "--out", str(out)])
    assert code == 0
    assert out.is_file()
    assert "PROPAGATED" in out.read_text(encoding="utf-8")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest scripts/drift_check/tests/test_run.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.drift_check.run'`

- [ ] **Step 3: Write minimal implementation**

```python
# scripts/drift_check/run.py
"""CLI entry: scan STRATEGY.md for unpropagated supersessions (surfaced, exit 0)."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from scripts.drift_check.markers import parse_markers
from scripts.drift_check.models import Finding
from scripts.drift_check.propagation import evaluate
from scripts.drift_check.report import render, summary_line
from scripts.drift_check.targets import default_memory_dir

_STRATEGY_REL = Path("docs") / "STRATEGY.md"


def run_check(repo_root: Path, memory_dir: Path | None = None) -> tuple[str, list[Finding]]:
    mem = memory_dir if memory_dir is not None else default_memory_dir(repo_root)
    doc_text = (repo_root / _STRATEGY_REL).read_text(encoding="utf-8")
    markers = parse_markers(doc_text, "STRATEGY.md")
    findings: list[Finding] = []
    for marker in markers:
        findings.extend(evaluate(marker, repo_root=repo_root, memory_dir=mem))
    return render(findings), findings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Drift Check — D1 supersession propagation (surfaced).")
    parser.add_argument("--repo-root", default=".", help="repo root (default: cwd)")
    parser.add_argument("--out", default=None, help="report path (default: <repo>/docs/drift-report.md)")
    args = parser.parse_args(argv)

    repo_root = Path(args.repo_root).resolve()
    out_path = Path(args.out) if args.out else repo_root / "docs" / "drift-report.md"
    try:
        markdown, findings = run_check(repo_root=repo_root)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(markdown, encoding="utf-8")
        print(f"drift-check: {summary_line(findings)}  → {out_path}")
    except Exception as exc:  # noqa: BLE001 — surfaced·non-blocking: I/O 실패도 gate 금지(spec §1/§7)
        print(f"drift-check: skipped (non-blocking) — {type(exc).__name__}: {exc}", file=sys.stderr)
    return 0  # surfaced · never blocks (항상 exit 0)


if __name__ == "__main__":  # `python3 -m scripts.drift_check.run` 진입점(없으면 import 후 조용히 종료)
    raise SystemExit(main())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest scripts/drift_check/tests/test_run.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Add report output to .gitignore + commit**

```bash
# idempotent — append each entry only if absent (safe to re-run)
grep -qxF '# drift-check surfaced output (regenerated; not committed — spec §7)' .gitignore 2>/dev/null \
  || printf '\n# drift-check surfaced output (regenerated; not committed — spec §7)\n' >> .gitignore
for entry in 'docs/drift-report.md' 'docs/superpowers/**/*.review.md' '.claude/codex-app-server-logs/'; do
  grep -qxF "$entry" .gitignore 2>/dev/null || printf '%s\n' "$entry" >> .gitignore
done
git add scripts/drift_check/run.py scripts/drift_check/tests/test_run.py .gitignore
git commit -m "feat(drift-check): CLI orchestration + gitignore surfaced output"
```

---

### Task 7: 골든 회귀 (픽스처 스냅샷)

**Files:**
- Create: `scripts/drift_check/tests/fixtures/golden_strategy.md`
- Create: `scripts/drift_check/tests/fixtures/CLAUDE.md`
- Create: `scripts/drift_check/tests/fixtures/mem/app-identity-decision.md`
- Test: `scripts/drift_check/tests/test_golden.py`

**Interfaces:**
- Consumes: `run_check` (run).
- Purpose: 2026-06-29 baseline *직전* 상태를 박제한 합성 스냅샷에서 도구가 알려진 전파-지연을 재발견하는지 고정. 살아있는 repo 비대상(repo는 #1 이미 전파됨). 각 candidate state 1건씩 커버: 미전파(PROPAGATION_MISSING), 전파됨(PROPAGATED, 음성 대조), 해석불가(NEEDS_MANUAL_REVIEW).

- [ ] **Step 1: Create the fixture snapshot files**

```markdown
<!-- scripts/drift_check/tests/fixtures/golden_strategy.md -->
# STRATEGY (golden snapshot — pre-2026-06-29)

> **⚠ SUPERSEDED (2026-06-28):** 진단 fully out. **CLAUDE.md** + [[app-identity-decision]] + [[ghost-note]] 갱신 필요.
```

```markdown
<!-- scripts/drift_check/tests/fixtures/CLAUDE.md -->
The diagnosis is a one-time acquisition hook. (pre-fix snapshot — no back-reference to the source doc yet)
```

```markdown
<!-- scripts/drift_check/tests/fixtures/mem/app-identity-decision.md -->
diagnosis = one-time hook. updated per STRATEGY §7 trajectory.
```

- [ ] **Step 2: Write the golden test (expected to fail until fixtures resolve)**

```python
# scripts/drift_check/tests/test_golden.py
from pathlib import Path
from scripts.drift_check.run import run_check

_FIX = Path(__file__).parent / "fixtures"


def test_golden_reproduces_known_propagation_states(tmp_path: Path):
    # Lay the snapshot into a repo shape: docs/STRATEGY.md + CLAUDE.md + mem/
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "STRATEGY.md").write_text(
        (_FIX / "golden_strategy.md").read_text(encoding="utf-8"), encoding="utf-8"
    )
    (tmp_path / "CLAUDE.md").write_text(
        (_FIX / "CLAUDE.md").read_text(encoding="utf-8"), encoding="utf-8"
    )
    mem = tmp_path / "mem"
    mem.mkdir()
    (mem / "app-identity-decision.md").write_text(
        (_FIX / "mem" / "app-identity-decision.md").read_text(encoding="utf-8"), encoding="utf-8"
    )

    _, findings = run_check(repo_root=tmp_path, memory_dir=mem)
    # exactly 3 targets — guards against _FILENAME_RE double-matching a wikilink's .md
    assert len(findings) == 3
    by_target = {f.target_raw: f.state for f in findings}
    assert set(by_target) == {"CLAUDE.md", "[[app-identity-decision]]", "[[ghost-note]]"}
    assert by_target["CLAUDE.md"] == "PROPAGATION_MISSING"          # pre-fix: no back-ref
    assert by_target["[[app-identity-decision]]"] == "PROPAGATED"   # has back-ref (negative control)
    assert by_target["[[ghost-note]]"] == "NEEDS_MANUAL_REVIEW"     # unresolvable
```

- [ ] **Step 3: Run the golden test**

Run: `python3 -m pytest scripts/drift_check/tests/test_golden.py -v`
Expected: PASS (fixtures + all prior tasks make it green)

- [ ] **Step 4: Run the full suite**

Run: `python3 -m pytest scripts/drift_check/tests/ -v`
Expected: PASS (all tests across Tasks 1–7)

- [ ] **Step 5: Smoke-run against the live repo (manual verification)**

Run: `cd /Users/opty/Code/personal-color-kr && python3 -m scripts.drift_check.run`
Expected: exit 0; prints a summary; writes `docs/drift-report.md`. Because drift #1 was already propagated (CLAUDE.md now back-references STRATEGY §7), the live diagnosis marker should show **PROPAGATED**, not PROPAGATION_MISSING — confirming the measure→fix→re-measure loop closes.

- [ ] **Step 6: Commit**

```bash
git add scripts/drift_check/tests/fixtures scripts/drift_check/tests/test_golden.py
git commit -m "test(drift-check): golden fixture regression for D1 propagation states"
```

---

## Self-Review

**Spec coverage (Phase 1 rows only):**
- §4 D1 (supersession-전파, plane 가드, 후보상태) → Tasks 2,4 (+ corrected plane rule in Global Constraints). ✓
- §4 D1 판정규칙(역참조 한계, J로 유예) → `has_backreference` docstring + PROPAGATED 의미 한정. ✓
- §5 컴포넌트(markers/targets/propagation/report/run) + 타깃 해석(memory=repo 밖) → Tasks 2,3,4,5,6. ✓
- §6 데이터 흐름(deterministic findings) → run.py. (J/`drift-judgments.json` merge = Phase 3, out of scope.) ✓
- §7 출력(surfaced·재생성·gitignore·code-wins) → Task 5 render + Task 6 gitignore. ✓
- §8 에러처리: 파싱불가 → NEEDS_MANUAL_REVIEW(Task 4). (git skip = N/A, Phase 1 무-git.) ✓
- §9 골든 = 픽스처 스냅샷, Phase1=D1만 → Task 7. ✓
- §11 Phase 1 정의 = D1 + report + 골든 → 전체. ✓ (D2/D3/D4/J = 후속 Phase, 의도적 제외.)

**Placeholder scan:** 모든 step에 실제 코드/명령/기대출력 포함. "TBD"/"적절히"/"유사하게" 없음. ✓

**Type consistency:** `Target(raw, source_syntax, canonical_path, section_id)` / `Marker(location, keyword, date, raw_text, targets)` / `Finding(marker_location, target_raw, target_path, state, evidence)` — Tasks 1·2·3·4·5·6 전부 동일 시그니처. `parse_markers`/`resolve`/`evaluate`/`has_backreference`/`render`/`summary_line`/`run_check`/`main` 이름·인자 일관. ✓

**Spec↔plan drift (발견·해소):** §4 D1의 "plane∈{...}로 분류된 marker만 파싱"을 문자 그대로면 §7-G([decision] 태그) 제외 → flagship 미탐. plan은 *타깃-기반* 가드로 교정(Global Constraints). 스펙 §4 D1은 이미 R2 revision에서 *타깃-기반*으로 갱신 완료(spec frontmatter `Revisions: 2026-06-29 R2`) → 정합.

**Revisions:**
- 2026-06-29 R1: codex review R1 critical 3 / high 4 반영 — 실행 인터프리터 `python`→`python3`(이 환경엔 `python` 부재) + repo-root/namespace-package 실행 invariant 명시; `run.py`에 `if __name__ == "__main__"` 진입점(smoke step 무동작 버그); golden `CLAUDE.md` fixture에서 `STRATEGY` 단어 제거(오탐 PROPAGATED→PROPAGATION_MISSING 교정) + `len(findings)==3` 단언 강화; `_FILENAME_RE` wikilink-내부 `.md` 중복매칭 차단; `main()` I/O 예외 surfaced·exit-0 가드; `source_syntax="adr"` 인터페이스 정합(미지원 명시).

---

## 알려진 제약 (Phase 1, 의도적)

- **마커 = 한 줄 한정.** 멀티라인 블록 마커(§7-G처럼 헤딩+불릿 분리)는 Phase 1 미지원 → 같은 줄에 키워드+타깃 있어야 캡처. (멀티라인 캡처 = fast-follow.)
- **ADR(`docs/decisions/*.md`) 경로-한정 참조 미해석.** spec §4/§5는 ADR을 cross-file 타깃에 포함하나, Phase 1 파서는 `[A-Za-z0-9_-]+\.md` basename만 추출 → `docs/decisions/0002-foo.md`는 `0002-foo.md`로만 잡혀 `repo_root/0002-foo.md` 부재 → `NEEDS_MANUAL_REVIEW`로 안전 강등(추측 금지, 조용한 오탐 아님). 경로-한정 ADR 해석 + `source_syntax="adr"` = fast-follow.
- **git advisory 없음** → `PROPAGATION_STALE_CANDIDATE` 미산출(Phase 3).
- **역참조 = substring** → 잔존 superseded 본문 동거 시 false-PROPAGATED 가능(J/Phase 3가 잡음). Phase 1은 VALID 단정 안 함으로 이를 정직하게 한정.
