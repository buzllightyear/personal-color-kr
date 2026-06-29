# Drift Check — Phase 2 (D4 config-seam) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 두 config 선언(`ci.yml`의 pytest 핀 ↔ `apps/api/pyproject.toml` dev 그룹의 pytest 핀)의 버전 명세 교집합을 결정론적으로 비교해, 모순이면 surfaced 리포트로 올리는 D4 config-seam 탐지기 — D1 옆에 두 번째 탐지기로 추가.

**Architecture:** 순수 버전-명세 층(`version_specifiers`: parse + 교집합 satisfiability, I/O 없음) → I/O seam 층(`config_seams`: 선언된 seam 데이터 + 추출기 + evaluate) → 기존 `report`에 D4 섹션 추가 → 기존 `run`이 D1 다음 D4를 돌려 한 리포트로 합침. 결정론적(J 없음) — 버전 구간 연산은 정확. git·네트워크·LLM 무관.

**Tech Stack:** Python 3.12, 표준 라이브러리만(`re`, `pathlib`, `dataclasses`, **`tomllib`**, `argparse`), pytest. 위치 `scripts/drift_check/`.

## Global Constraints

- **Surfaced only** — 절대 gate/block/auto-fix 안 함. D4는 새 gate를 추가하지 않는다. 출력은 리포트뿐, `main()`은 항상 exit 0.
- **No new dependency** — `tomllib`은 Python 3.11+ 표준 라이브러리(신규 의존성 아님). YAML 파서 같은 외부 의존성 금지 — `ci.yml`은 regex로 읽는다. LLM 의존성 0 유지.
- **No "code wins" auto-pick (D4 한정)** — D1과 달리 양쪽 다 config라 승자를 고르지 않는다. human action = *"두 선언 화해 — CI는 실행되는 현실, pyproject는 로컬 `uv sync` 해석값"*. 맥락만 surface, 코드/config를 바꾸자고 제안하지 않는다.
- **Never crash, never guess** — 파일 부재·명세 추출 실패·미지원 연산자(`!= ~= ===` 등)는 모두 `NEEDS_MANUAL_REVIEW`로 surface(예외 전파 금지, 추측 금지). 지원 연산자는 `< <= > >= ==` 뿐.
- **No self-defeating live test** — 커밋되는 테스트는 **합성 픽스처(tmp_path)만** 쓴다. 실제 repo의 pytest mismatch를 assert하는 커밋 테스트는 금지 — seam이 화해(수정)되는 순간 깨지고, 그 수정이 바로 이 도구의 *목표*다(Phase 1 골든이 "STRATEGY" 문자열을 안 담은 것과 동형의 교훈). 실제 repo 라이브 스모크는 컨트롤러가 수동 실행으로 확인.
- **Python 규약:** PEP8, 모든 함수 시그니처에 타입 주석, immutability = `@dataclass(frozen=True)`(새 객체 반환, 변이 금지), `from __future__ import annotations`, black·ruff 통과.
- **D4 candidate states:** `CONFIG_CONSISTENT` / `CONFIG_SEAM_MISMATCH` / `NEEDS_MANUAL_REVIEW`. (D1의 `Finding`과 별개 타입 `ConfigFinding` — seam-쌍 vs marker→target.)
- **D2(태그-린트)는 이 Phase에서 구현하지 않는다** — 측정상 무신호(스펙 §12.5/R3). `tags.py`를 만들지 말 것.

**Execution invariant (모든 step 명령에 적용):** *반드시 repo root(`/Users/opty/Code/personal-color-kr`)를 cwd로* 실행하고 인터프리터는 `python3`다 — 이 환경엔 `python` 실행파일이 없다(`python3`만). `scripts/`엔 `__init__.py`가 **없다**(PEP 420 namespace package, 기존 관례). `from scripts.drift_check.…` 임포트는 repo root가 `sys.path`에 있을 때만 해석되며, repo root에서 `python3 -m pytest`(+ root `pytest.ini`의 `--import-mode=importlib`) 실행 시 자동 충족된다. `scripts/__init__.py`를 추가하지 **말 것**.

Run tests from repo root: `python3 -m pytest scripts/drift_check/tests/ -v`

---

## File Structure

```
scripts/drift_check/
  models.py                 # +SeamSource, +ConfigSeam, +ConfigFinding (frozen)   (Task 1)
  version_specifiers.py     # parse_specifier / is_satisfiable  (pure, no I/O)    (Task 2)  [NEW]
  config_seams.py           # SEAMS 선언 + 추출기 + evaluate(repo_root)            (Task 3)  [NEW]
  report.py                 # +_render_d4 / +config_summary_line, render() 합성    (Task 4)
  run.py                    # run_check가 D4 평가·합성 리포트 반환(3-tuple)         (Task 5)
  tests/
    test_models.py          # +ConfigFinding 등 (Task 1)
    test_version_specifiers.py  # 진리표                (Task 2)  [NEW]
    test_config_seams.py    # 추출기 + evaluate (tmp_path) (Task 3)  [NEW]
    test_report.py          # +D4 섹션·요약 (Task 4)
    test_run.py             # unpacking 3-tuple + D4 결합 (Task 5)
    test_golden.py          # unpacking 3-tuple (assertion 불변) (Task 5)
```

각 유닛 1책임: `version_specifiers`=순수 버전 수학(독립 단위테스트), `config_seams`=I/O+선언, `report`=렌더, `run`=오케스트레이션.

---

## Task 1: models — D4 value objects

**Files:**
- Modify: `scripts/drift_check/models.py` (append 3 frozen dataclasses)
- Test: `scripts/drift_check/tests/test_models.py` (append)

**Interfaces:**
- Produces:
  - `SeamSource(file: str, kind: str, group: str | None = None)` — `kind ∈ {"yaml-regex","toml-dep-group"}`; `group`은 toml dependency-group 이름(예 `"dev"`), yaml은 `None`.
  - `ConfigSeam(name: str, package: str, source_a: SeamSource, source_b: SeamSource)`
  - `ConfigFinding(seam_name: str, value_a: str | None, value_b: str | None, state: str, evidence: str)`

- [ ] **Step 1: Write the failing test** (append to `scripts/drift_check/tests/test_models.py`)

```python
import pytest
from scripts.drift_check.models import SeamSource, ConfigSeam, ConfigFinding


def test_seam_source_is_frozen():
    s = SeamSource(file=".github/workflows/ci.yml", kind="yaml-regex")
    assert s.group is None
    with pytest.raises(Exception):
        s.file = "x"  # frozen → FrozenInstanceError


def test_config_seam_holds_two_sources():
    seam = ConfigSeam(
        name="pytest-version-pin",
        package="pytest",
        source_a=SeamSource(file="a", kind="yaml-regex"),
        source_b=SeamSource(file="b", kind="toml-dep-group", group="dev"),
    )
    assert seam.package == "pytest"
    assert seam.source_b.group == "dev"


def test_config_finding_fields():
    f = ConfigFinding(
        seam_name="pytest-version-pin", value_a="<9.1", value_b=">=9.1.1",
        state="CONFIG_SEAM_MISMATCH", evidence="ev",
    )
    assert f.state == "CONFIG_SEAM_MISMATCH"
    assert (f.value_a, f.value_b) == ("<9.1", ">=9.1.1")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest scripts/drift_check/tests/test_models.py -v`
Expected: FAIL — `ImportError: cannot import name 'SeamSource'`.

- [ ] **Step 3: Write minimal implementation** (append to `scripts/drift_check/models.py`, after the existing `Finding` class)

```python
@dataclass(frozen=True)
class SeamSource:
    """One side of a config-seam: where a shared value is declared + how to read it."""

    file: str                     # repo-relative path, e.g. ".github/workflows/ci.yml"
    kind: str                     # "yaml-regex" | "toml-dep-group"
    group: str | None = None      # toml dependency-group name (e.g. "dev"); None for yaml-regex


@dataclass(frozen=True)
class ConfigSeam:
    """A declared invariant: two places that declare the same value must stay compatible."""

    name: str                     # "pytest-version-pin"
    package: str                  # "pytest"
    source_a: SeamSource
    source_b: SeamSource


@dataclass(frozen=True)
class ConfigFinding:
    """One config-seam comparison verdict (deterministic — no J stage)."""

    seam_name: str
    value_a: str | None           # extracted specifier e.g. "<9.1"; None if unextractable
    value_b: str | None
    state: str                    # "CONFIG_CONSISTENT" | "CONFIG_SEAM_MISMATCH" | "NEEDS_MANUAL_REVIEW"
    evidence: str
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest scripts/drift_check/tests/test_models.py -v`
Expected: PASS (all model tests, old + new).

- [ ] **Step 5: Commit**

```bash
git add scripts/drift_check/models.py scripts/drift_check/tests/test_models.py
git commit -m "feat(drift-check): add D4 config-seam value objects (SeamSource/ConfigSeam/ConfigFinding)"
```

---

## Task 2: version_specifiers — pure version math

**Files:**
- Create: `scripts/drift_check/version_specifiers.py`
- Test: `scripts/drift_check/tests/test_version_specifiers.py`

**Interfaces:**
- Produces:
  - `parse_specifier(spec: str) -> list[tuple[str, tuple[int, ...]]] | None` — `"<9.1"` → `[("<", (9, 1))]`; multi-clause comma-split; `""` → `[]` (no constraint); **`None`** if any clause uses an unsupported operator or is unparseable.
  - `is_satisfiable(clauses: list[tuple[str, tuple[int, ...]]]) -> bool` — True iff some version satisfies every clause (intersection non-empty).
- Consumes: nothing (pure, stdlib `re` only).

- [ ] **Step 1: Write the failing test** (`scripts/drift_check/tests/test_version_specifiers.py`)

```python
from scripts.drift_check.version_specifiers import parse_specifier, is_satisfiable


def test_parse_single_clause():
    assert parse_specifier("<9.1") == [("<", (9, 1))]


def test_parse_multi_clause_comma_split():
    assert parse_specifier(">=9.1,<10") == [(">=", (9, 1)), ("<", (10,))]


def test_parse_empty_is_no_constraint():
    assert parse_specifier("") == []
    assert parse_specifier("   ") == []


def test_parse_unsupported_operator_returns_none():
    assert parse_specifier("~=9.1") is None
    assert parse_specifier("!=9.1") is None
    assert parse_specifier("===9.1") is None


def test_parse_garbage_returns_none():
    assert parse_specifier("pytest9") is None
    assert parse_specifier("<>9") is None


def test_real_pytest_pin_is_unsatisfiable():
    # the live drift: CI `<9.1` vs pyproject `>=9.1.1`
    clauses = parse_specifier("<9.1") + parse_specifier(">=9.1.1")
    assert is_satisfiable(clauses) is False


def test_overlapping_ranges_satisfiable():
    assert is_satisfiable(parse_specifier(">=9.1") + parse_specifier("<10")) is True


def test_point_equality_within_range_satisfiable():
    assert is_satisfiable(parse_specifier("==9.1.1") + parse_specifier(">=9.1")) is True


def test_point_equality_outside_range_unsatisfiable():
    assert is_satisfiable(parse_specifier("==9.0") + parse_specifier(">=9.1")) is False


def test_trailing_zero_normalization_satisfiable():
    # 9.1 == 9.1.0 : `<=9.1` ∧ `>=9.1.0` feasible exactly at 9.1
    assert is_satisfiable(parse_specifier("<=9.1") + parse_specifier(">=9.1.0")) is True


def test_trailing_zero_equivalence_in_tight_bound_selection():
    # max()/min() over raw tuples can pick a different-length but equal version;
    # these prove the inclusivity verdict stays correct across that normalization.
    assert is_satisfiable(parse_specifier("==9.1") + parse_specifier("==9.1.0")) is True   # same point
    assert is_satisfiable(parse_specifier("==9.1") + parse_specifier(">9.1.0")) is False    # 9.1 not > 9.1.0
    assert is_satisfiable(parse_specifier(">9.1") + parse_specifier("<=9.1.0")) is False    # (9.1, 9.1] empty
    # mixed-length, multiple lower+upper bounds collapse to the right interval [9.1.5, 9.3)
    assert is_satisfiable(
        parse_specifier(">=9.1,>=9.1.5") + parse_specifier("<10,<9.3")
    ) is True


def test_exclusive_bound_touching_is_unsatisfiable():
    # nothing is both `<9.1` and `>=9.1`
    assert is_satisfiable(parse_specifier("<9.1") + parse_specifier(">=9.1")) is False


def test_single_sided_and_empty_are_satisfiable():
    assert is_satisfiable(parse_specifier(">=9.1")) is True
    assert is_satisfiable(parse_specifier("<9.1")) is True
    assert is_satisfiable([]) is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest scripts/drift_check/tests/test_version_specifiers.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.drift_check.version_specifiers'`.

- [ ] **Step 3: Write minimal implementation** (`scripts/drift_check/version_specifiers.py`)

```python
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


def _pad(a: tuple[int, ...], b: tuple[int, ...]) -> tuple[tuple[int, ...], tuple[int, ...]]:
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest scripts/drift_check/tests/test_version_specifiers.py -v`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/drift_check/version_specifiers.py scripts/drift_check/tests/test_version_specifiers.py
git commit -m "feat(drift-check): add pure version-specifier parse + intersection satisfiability (D4)"
```

---

## Task 3: config_seams — declarations, extractors, evaluate

**Files:**
- Create: `scripts/drift_check/config_seams.py`
- Test: `scripts/drift_check/tests/test_config_seams.py`

**Interfaces:**
- Consumes: `models.{SeamSource, ConfigSeam, ConfigFinding}` (Task 1), `version_specifiers.{parse_specifier, is_satisfiable}` (Task 2).
- Produces:
  - `extract_yaml_pin(text: str, package: str) -> str | None` — pip-requirement spec where the operator immediately follows the package name (no space), so prose like `"pytest is pinned <9.1"` is **not** matched.
  - `extract_toml_pin(text: str, package: str, group: str | None) -> str | None` — `tomllib` parse → `[dependency-groups][group]` → the entry whose name is `package` followed by an operator.
  - `SEAMS: tuple[ConfigSeam, ...]` — declared seams (v1: the pytest pin).
  - `evaluate(repo_root: Path) -> list[ConfigFinding]` — one ConfigFinding per seam.

- [ ] **Step 1: Write the failing test** (`scripts/drift_check/tests/test_config_seams.py`)

```python
from pathlib import Path

from scripts.drift_check.config_seams import (
    evaluate,
    extract_toml_pin,
    extract_yaml_pin,
)


def test_yaml_pin_extracts_requirement_spec():
    text = "          python -m pip install 'pytest<9.1' pytest-asyncio mypy ruff\n"
    assert extract_yaml_pin(text, "pytest") == "<9.1"


def test_yaml_pin_ignores_prose_mention():
    # space between package and operator → not a requirement spec
    text = "# pytest is pinned <9.1: pytest 9.1.0 changed caplog so a record\n"
    assert extract_yaml_pin(text, "pytest") is None


def test_yaml_pin_respects_left_token_boundary():
    # "pytest" as a substring of another token must not match
    text = "install 'notpytest<9.1' and 'my-pytest<9.1'\n"
    assert extract_yaml_pin(text, "pytest") is None


def test_toml_pin_extracts_from_dep_group():
    text = '[dependency-groups]\ndev = ["httpx>=0.28.1", "pytest>=9.1.1", "pytest-asyncio>=1.4.0"]\n'
    assert extract_toml_pin(text, "pytest", "dev") == ">=9.1.1"


def test_toml_pin_does_not_match_sibling_package():
    text = '[dependency-groups]\ndev = ["pytest-asyncio>=1.4.0"]\n'
    assert extract_toml_pin(text, "pytest", "dev") is None


def _lay(tmp_path: Path, ci_spec: str, toml_spec: str) -> None:
    wf = tmp_path / ".github" / "workflows"
    wf.mkdir(parents=True)
    (wf / "ci.yml").write_text(f"        run: pip install 'pytest{ci_spec}'\n", encoding="utf-8")
    api = tmp_path / "apps" / "api"
    api.mkdir(parents=True)
    (api / "pyproject.toml").write_text(
        f'[dependency-groups]\ndev = ["pytest{toml_spec}"]\n', encoding="utf-8"
    )


def test_evaluate_flags_contradictory_pins(tmp_path: Path):
    _lay(tmp_path, "<9.1", ">=9.1.1")
    findings = evaluate(tmp_path)
    assert len(findings) == 1
    f = findings[0]
    assert f.state == "CONFIG_SEAM_MISMATCH"
    assert (f.value_a, f.value_b) == ("<9.1", ">=9.1.1")
    assert f.seam_name == "pytest-version-pin"


def test_evaluate_passes_compatible_pins(tmp_path: Path):
    _lay(tmp_path, ">=9.1", ">=9.1.1")
    assert evaluate(tmp_path)[0].state == "CONFIG_CONSISTENT"


def test_evaluate_missing_files_is_manual_review(tmp_path: Path):
    # nothing laid down → both sources unextractable
    f = evaluate(tmp_path)[0]
    assert f.state == "NEEDS_MANUAL_REVIEW"
    assert f.value_a is None and f.value_b is None


def test_evaluate_unsupported_operator_is_manual_review(tmp_path: Path):
    # toml `~=9.1` is extracted (operator-led) but parse_specifier rejects it
    _lay(tmp_path, ">=9.1", "~=9.1")
    f = evaluate(tmp_path)[0]
    assert f.state == "NEEDS_MANUAL_REVIEW"
    assert f.value_b == "~=9.1"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest scripts/drift_check/tests/test_config_seams.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.drift_check.config_seams'`.

- [ ] **Step 3: Write minimal implementation** (`scripts/drift_check/config_seams.py`)

```python
"""Config-seam declarations + extractors + evaluation. [Phase 2 D4]"""
from __future__ import annotations

import re
import tomllib
from pathlib import Path

from scripts.drift_check.models import ConfigFinding, ConfigSeam, SeamSource
from scripts.drift_check.version_specifiers import is_satisfiable, parse_specifier

_OP = r"(<=|>=|==|<|>)"


def extract_yaml_pin(text: str, package: str) -> str | None:
    """Return the version spec for *package* from a pip-requirement string.

    The operator must immediately follow the package name (no space), as in
    ``'pytest<9.1'`` — this excludes prose mentions like ``pytest is pinned <9.1``.
    The left ``(?<![\w.-])`` lookbehind anchors the package as a whole token, so a
    substring like ``notpytest<9`` / ``my-pytest<9`` does not match.
    """
    m = re.search(r"(?<![\w.-])" + re.escape(package) + _OP + r"([0-9]+(?:\.[0-9]+)*)", text)
    return f"{m.group(1)}{m.group(2)}" if m else None


def extract_toml_pin(text: str, package: str, group: str | None) -> str | None:
    """Return the version spec for *package* from ``[dependency-groups][group]``."""
    try:
        data = tomllib.loads(text)
    except tomllib.TOMLDecodeError:
        return None
    deps = data.get("dependency-groups", {}).get(group or "", [])
    for entry in deps:
        if isinstance(entry, str) and entry.startswith(package):
            spec = entry[len(package):].strip()
            if spec[:1] in "<>=!~":  # operator follows → this package's pin (not a sibling)
                return spec
    return None


SEAMS: tuple[ConfigSeam, ...] = (
    ConfigSeam(
        name="pytest-version-pin",
        package="pytest",
        source_a=SeamSource(file=".github/workflows/ci.yml", kind="yaml-regex"),
        source_b=SeamSource(file="apps/api/pyproject.toml", kind="toml-dep-group", group="dev"),
    ),
)


def _extract(repo_root: Path, source: SeamSource, package: str) -> str | None:
    path = repo_root / source.file
    if not path.is_file():
        return None
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None  # read/decode failure → None → NEEDS_MANUAL_REVIEW (never crash, never lose the run)
    if source.kind == "yaml-regex":
        return extract_yaml_pin(text, package)
    if source.kind == "toml-dep-group":
        return extract_toml_pin(text, package, source.group)
    return None


def _judge(seam: ConfigSeam, va: str | None, vb: str | None) -> ConfigFinding:
    if va is None or vb is None:
        return ConfigFinding(seam.name, va, vb, "NEEDS_MANUAL_REVIEW",
                             f"명세 추출 실패 (a={va!r}, b={vb!r})")
    ca, cb = parse_specifier(va), parse_specifier(vb)
    if ca is None or cb is None:
        return ConfigFinding(seam.name, va, vb, "NEEDS_MANUAL_REVIEW",
                             f"미지원 연산자 (a={va!r}, b={vb!r})")
    if is_satisfiable(ca + cb):
        return ConfigFinding(seam.name, va, vb, "CONFIG_CONSISTENT",
                             f"{seam.package} {va} ∧ {vb}: 교집합 비공집합")
    return ConfigFinding(seam.name, va, vb, "CONFIG_SEAM_MISMATCH",
                         f"{seam.package} {va} ∧ {vb}: 교집합 공집합")


def evaluate(repo_root: Path) -> list[ConfigFinding]:
    """Evaluate every declared config-seam against files under *repo_root*."""
    findings: list[ConfigFinding] = []
    for seam in SEAMS:
        va = _extract(repo_root, seam.source_a, seam.package)
        vb = _extract(repo_root, seam.source_b, seam.package)
        findings.append(_judge(seam, va, vb))
    return findings
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest scripts/drift_check/tests/test_config_seams.py -v`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/drift_check/config_seams.py scripts/drift_check/tests/test_config_seams.py
git commit -m "feat(drift-check): add D4 config-seam extractors + evaluate (pytest pin seam)"
```

---

## Task 4: report — D4 section + summary, composed render

**Files:**
- Modify: `scripts/drift_check/report.py`
- Test: `scripts/drift_check/tests/test_report.py` (append)

**Interfaces:**
- Consumes: `models.ConfigFinding` (Task 1).
- Produces:
  - `config_summary_line(config_findings: list[ConfigFinding]) -> str`
  - `render(findings, config_findings=(), markers_scanned=None) -> str` — **signature extended** with a `config_findings` keyword param defaulting to `()` (existing `render(findings)` / `render(findings, markers_scanned=6)` calls stay valid). Output = D1 section then D4 section, joined by a blank line.
- Existing `summary_line(findings)` is unchanged.

- [ ] **Step 1: Write the failing test** (append to `scripts/drift_check/tests/test_report.py`)

```python
from scripts.drift_check.models import ConfigFinding
from scripts.drift_check.report import config_summary_line


def _cf(state: str) -> ConfigFinding:
    return ConfigFinding(seam_name="pytest-version-pin", value_a="<9.1",
                         value_b=">=9.1.1", state=state, evidence="ev")


def test_config_summary_line_counts_states():
    out = config_summary_line([_cf("CONFIG_SEAM_MISMATCH"), _cf("CONFIG_CONSISTENT")])
    assert out == "1 CONFIG_CONSISTENT, 1 CONFIG_SEAM_MISMATCH, 0 NEEDS_MANUAL_REVIEW"


def test_render_includes_d4_section_when_config_findings():
    md = render([], config_findings=[_cf("CONFIG_SEAM_MISMATCH")])
    assert "D4 config-seam" in md
    assert "CONFIG_SEAM_MISMATCH" in md
    assert "pytest-version-pin" in md
    assert "코드 변경" not in md  # surfaced·no code-edit proposal


def test_render_backward_compatible_d1_only_still_starts_with_title():
    md = render([_f("PROPAGATION_MISSING")])
    assert md.startswith("# Drift Report")
    assert "PROPAGATION_MISSING" in md
```

(`render` and `_f` are already imported/defined at the top of this test file from Phase 1.)

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest scripts/drift_check/tests/test_report.py -v`
Expected: FAIL — `ImportError: cannot import name 'config_summary_line'`.

- [ ] **Step 3: Write minimal implementation**

Replace the body of `scripts/drift_check/report.py` with the following (the existing D1 logic is preserved verbatim inside `_render_d1`; only the composing `render` and the new D4 helpers are added):

```python
"""Render D1 + D4 findings to a surfaced markdown report (pure)."""
from __future__ import annotations

from collections.abc import Sequence

from scripts.drift_check.models import ConfigFinding, Finding

_STATES = ("PROPAGATED", "PROPAGATION_MISSING", "NEEDS_MANUAL_REVIEW")
_ACTION = {
    "PROPAGATED": "—",
    "PROPAGATION_MISSING": "타깃 문서에 STRATEGY 변경 반영(역참조 추가)했는지 확인",
    "NEEDS_MANUAL_REVIEW": "타깃 수동 확인(해석 불가)",
}

_CONFIG_STATES = ("CONFIG_CONSISTENT", "CONFIG_SEAM_MISMATCH", "NEEDS_MANUAL_REVIEW")
_CONFIG_ACTION = {
    "CONFIG_CONSISTENT": "—",
    "CONFIG_SEAM_MISMATCH": "두 선언 화해 — CI는 실행되는 현실, pyproject는 로컬 `uv sync` 해석값",
    "NEEDS_MANUAL_REVIEW": "수동 확인(명세 추출/파싱 불가)",
}


def summary_line(findings: list[Finding]) -> str:
    counts = {s: sum(1 for f in findings if f.state == s) for s in _STATES}
    return ", ".join(f"{counts[s]} {s}" for s in _STATES)


def config_summary_line(config_findings: list[ConfigFinding]) -> str:
    cf = list(config_findings)
    counts = {s: sum(1 for f in cf if f.state == s) for s in _CONFIG_STATES}
    return ", ".join(f"{counts[s]} {s}" for s in _CONFIG_STATES)


def _render_d1(findings: list[Finding], markers_scanned: int | None) -> str:
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
    lines += [
        "",
        "_Phase 1 한계: 단일 줄 마커만 파싱(멀티라인 파킹 노트 미포착) · back-reference = 문서 전체 substring(거친 신호; J 단계에서 정밀화) · git 무관._",
    ]
    if markers_scanned is not None:
        lines.append(
            f"_스캔된 마커 줄: {markers_scanned} · 타깃 해석된 finding: {len(findings)}_"
        )
    return "\n".join(lines)


def _render_d4(config_findings: list[ConfigFinding]) -> str:
    lines = [
        "## D4 config-seam (surfaced)",
        "",
        "> 두 config 선언의 버전 명세 교집합을 비교. 결정론적·승자 미선정 — 사람이 화해.",
        "",
        "| seam | A | B | state | action |",
        "|---|---|---|---|---|",
    ]
    for f in config_findings:
        lines.append(
            f"| {f.seam_name} | {f.value_a} | {f.value_b} | {f.state} | {_CONFIG_ACTION[f.state]} |"
        )
    lines += ["", f"**Config summary:** {config_summary_line(config_findings)}"]
    return "\n".join(lines)


def render(
    findings: list[Finding],
    config_findings: Sequence[ConfigFinding] = (),
    markers_scanned: int | None = None,
) -> str:
    return "\n\n".join([_render_d1(findings, markers_scanned), _render_d4(list(config_findings))])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest scripts/drift_check/tests/test_report.py -v`
Expected: PASS — both the new D4 tests and all pre-existing Phase 1 report tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/drift_check/report.py scripts/drift_check/tests/test_report.py
git commit -m "feat(drift-check): render D4 config-seam section + config summary in report"
```

---

## Task 5: run — wire D4 into orchestration

**Files:**
- Modify: `scripts/drift_check/run.py`
- Test: `scripts/drift_check/tests/test_run.py` (update unpacking + add D4 assertion)
- Test: `scripts/drift_check/tests/test_golden.py` (update unpacking only — assertions unchanged)

**Interfaces:**
- Consumes: `config_seams.evaluate` (Task 3), `report.{render, summary_line, config_summary_line}` (Task 4), `models.{Finding, ConfigFinding}`.
- Produces: `run_check(repo_root, memory_dir=None) -> tuple[str, list[Finding], list[ConfigFinding]]` — **return widened to a 3-tuple** (markdown, D1 findings, D4 config findings).

- [ ] **Step 1: Update the two existing call-sites' unpacking, then write the failing D4 assertion**

First, edit `scripts/drift_check/tests/test_golden.py` line 22 — change the unpacking arity (the 3 assertions below it are unchanged):

```python
    _, findings, _ = run_check(repo_root=tmp_path, memory_dir=mem)
```

Then edit `scripts/drift_check/tests/test_run.py`: update the unpacking on the `run_check` call in `test_run_check_flags_missing_propagation` and append a new D4 test. The file becomes:

```python
from pathlib import Path
from scripts.drift_check.run import run_check, main


def _seed_repo(root: Path, claude_body: str) -> None:
    (root / "docs").mkdir(parents=True, exist_ok=True)
    (root / "docs" / "STRATEGY.md").write_text(
        "> **⚠ SUPERSEDED (2026-06-28):** CLAUDE.md needs update.\n", encoding="utf-8"
    )
    (root / "CLAUDE.md").write_text(claude_body, encoding="utf-8")


def _seed_config_seam(root: Path, ci_spec: str, toml_spec: str) -> None:
    wf = root / ".github" / "workflows"
    wf.mkdir(parents=True, exist_ok=True)
    (wf / "ci.yml").write_text(f"        run: pip install 'pytest{ci_spec}'\n", encoding="utf-8")
    api = root / "apps" / "api"
    api.mkdir(parents=True, exist_ok=True)
    (api / "pyproject.toml").write_text(
        f'[dependency-groups]\ndev = ["pytest{toml_spec}"]\n', encoding="utf-8"
    )


def test_run_check_flags_missing_propagation(tmp_path: Path):
    # NO config seam seeded (no ci.yml / pyproject.toml) → D4 must surface a clean
    # NEEDS_MANUAL_REVIEW row without crashing or perturbing the D1 result.
    _seed_repo(tmp_path, claude_body="no reference here")
    md, findings, config_findings = run_check(repo_root=tmp_path, memory_dir=tmp_path / "mem")
    assert [f.state for f in findings] == ["PROPAGATION_MISSING"]  # D1 unchanged
    assert "PROPAGATION_MISSING" in md
    assert [c.state for c in config_findings] == ["NEEDS_MANUAL_REVIEW"]  # D4 missing-config
    assert "D4 config-seam" in md
    assert "NEEDS_MANUAL_REVIEW" in md


def test_run_check_surfaces_config_seam_mismatch(tmp_path: Path):
    _seed_repo(tmp_path, claude_body="no reference here")
    _seed_config_seam(tmp_path, ci_spec="<9.1", toml_spec=">=9.1.1")
    md, findings, config_findings = run_check(repo_root=tmp_path, memory_dir=tmp_path / "mem")
    assert [c.state for c in config_findings] == ["CONFIG_SEAM_MISMATCH"]
    assert "D4 config-seam" in md
    assert "CONFIG_SEAM_MISMATCH" in md


def test_main_writes_report_and_exits_zero(tmp_path: Path):
    _seed_repo(tmp_path, claude_body="see STRATEGY.md §7")
    out = tmp_path / "docs" / "drift-report.md"
    code = main(["--repo-root", str(tmp_path), "--out", str(out)])
    assert code == 0
    assert out.is_file()
    assert "PROPAGATED" in out.read_text(encoding="utf-8")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest scripts/drift_check/tests/test_run.py scripts/drift_check/tests/test_golden.py -v`
Expected: FAIL — `ValueError: not enough values to unpack (expected 3, got 2)` (run_check still returns a 2-tuple).

- [ ] **Step 3: Write minimal implementation** — update `scripts/drift_check/run.py`

Change the imports near the top:

```python
from scripts.drift_check import config_seams
from scripts.drift_check.markers import parse_markers
from scripts.drift_check.models import ConfigFinding, Finding
from scripts.drift_check.propagation import evaluate
from scripts.drift_check.report import config_summary_line, render, summary_line
from scripts.drift_check.targets import default_memory_dir
```

Replace `run_check`:

```python
def run_check(
    repo_root: Path, memory_dir: Path | None = None
) -> tuple[str, list[Finding], list[ConfigFinding]]:
    mem = memory_dir if memory_dir is not None else default_memory_dir(repo_root)
    doc_text = (repo_root / _STRATEGY_REL).read_text(encoding="utf-8")
    markers = parse_markers(doc_text, "STRATEGY.md")
    findings: list[Finding] = []
    for marker in markers:
        findings.extend(evaluate(marker, repo_root=repo_root, memory_dir=mem))
    config_findings = config_seams.evaluate(repo_root)
    markdown = render(findings, config_findings, markers_scanned=len(markers))
    return markdown, findings, config_findings
```

Replace the `run_check` call + print inside `main` (inside the existing `try:` block):

```python
        markdown, findings, config_findings = run_check(repo_root=repo_root)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(markdown, encoding="utf-8")
        print(
            f"drift-check: {summary_line(findings)} | "
            f"{config_summary_line(config_findings)}  → {out_path}"
        )
```

(Everything else in `main` — argparse, the `except` fail-open, `return 0`, the `__main__` guard — is unchanged.)

- [ ] **Step 4: Run the full suite to verify it passes**

Run: `python3 -m pytest scripts/drift_check/tests/ -v`
Expected: PASS — all Phase 1 tests + all Phase 2 tests green.

- [ ] **Step 5: Live smoke (controller-run, not committed) + commit**

Run the tool against the real repo to confirm it surfaces the live pytest seam:

Run: `python3 -m scripts.drift_check.run`
Expected: exit 0; console summary includes `1 CONFIG_SEAM_MISMATCH`; `docs/drift-report.md` D4 section shows the `pytest-version-pin` row as `CONFIG_SEAM_MISMATCH` (`<9.1` vs `>=9.1.1`). *(This is a manual confirmation of the tool doing its job — there is no committed assertion against the real repo, per Global Constraints.)*

```bash
git add scripts/drift_check/run.py scripts/drift_check/tests/test_run.py scripts/drift_check/tests/test_golden.py
git commit -m "feat(drift-check): wire D4 config-seam into run_check + report (surfaced)"
```

---

## Self-Review

**1. Spec coverage (vs design §14):**
- §14.1 개념 (surfaced·결정론·승자 미선정) → Global Constraints + Task 4 `_CONFIG_ACTION` + Task 3 `_judge`. ✓
- §14.2 시드 seam (ci.yml ↔ pyproject, 교집합) → Task 3 `SEAMS` + `extract_*` + Task 2 `is_satisfiable`. ✓
- §14.3 컴포넌트 (`version_specifiers` 순수 / `config_seams` I/O / models +3 / report / run) → Tasks 1–5 one-to-one. ✓
- §14.4 데이터 흐름 (evaluate → render 합성) → Task 5 `run_check`. ✓
- §14.5 가드 (NEEDS_MANUAL_REVIEW·no auto-pick·no git·선언적 seam) → Global Constraints + Task 3. ✓
- §14.6 테스트 (진리표·추출기·골든 3상태·라이브 스모크) → Task 2 truth table, Task 3 extractor+evaluate, Task 5 smoke. ✓
- §12.5/R3 D2 보류 → Global Constraint "tags.py 만들지 말 것". ✓

**2. Placeholder scan:** no TBD/TODO/"handle edge cases"/"similar to Task N"; every code step shows full code. ✓

**3. Type consistency:** `ConfigFinding(seam_name, value_a, value_b, state, evidence)` — same field order in Task 1 def, Task 3 `_judge` positional calls, Task 4 `_cf`/`_render_d4`. `render(findings, config_findings=(), markers_scanned=None)` — same signature in Task 4 def and Task 5 call. `run_check → 3-tuple` — Task 5 def + both test unpackings (test_run, test_golden) updated. `is_satisfiable(list[Clause]) -> bool` / `parse_specifier -> list[Clause] | None` consistent across Tasks 2–3. ✓

**Note for the executor (pre-flight):** Task 5 edits two Phase 1 test files (`test_run.py`, `test_golden.py`) — this is an intentional unpacking-arity update (2-tuple → 3-tuple); the Phase 1 **assertions are unchanged**. This is not a test-weakening; it is required by the widened `run_check` return. No other Phase 1 test or assertion is touched.
