"""Config-seam declarations + extractors + evaluation. [Phase 2 D4]"""

from __future__ import annotations

import re
import tomllib
from pathlib import Path

from scripts.drift_check.models import ConfigFinding, ConfigSeam, SeamSource
from scripts.drift_check.version_specifiers import is_satisfiable, parse_specifier

_OP = r"(<=|>=|==|<|>)"


def extract_yaml_pin(text: str, package: str) -> str | None:
    r"""Return the version spec for *package* from a pip-requirement string.

    The operator must immediately follow the package name (no space), as in
    ``'pytest<9.1'`` — this excludes prose mentions like ``pytest is pinned <9.1``.
    The left ``(?<![\w.-])`` lookbehind anchors the package as a whole token, so a
    substring like ``notpytest<9`` / ``my-pytest<9`` does not match.
    """
    m = re.search(
        r"(?<![\w.-])" + re.escape(package) + _OP + r"([0-9]+(?:\.[0-9]+)*)", text
    )
    return f"{m.group(1)}{m.group(2)}" if m else None


def extract_toml_pin(text: str, package: str, group: str | None) -> str | None:
    """Return the version spec for *package* from ``[dependency-groups][group]``."""
    try:
        data = tomllib.loads(text)
    except tomllib.TOMLDecodeError:
        return None
    groups = data.get("dependency-groups", {})
    if not isinstance(groups, dict):
        return None
    deps = groups.get(group or "", [])
    if not isinstance(deps, list):
        return None
    for entry in deps:
        if isinstance(entry, str) and entry.startswith(package):
            spec = entry[len(package) :].strip()
            if spec and spec[0] in "<>=!~":  # operator-led → this is the pin
                return spec
    return None


SEAMS: tuple[ConfigSeam, ...] = (
    ConfigSeam(
        name="pytest-version-pin",
        package="pytest",
        source_a=SeamSource(file=".github/workflows/ci.yml", kind="yaml-regex"),
        source_b=SeamSource(
            file="apps/api/pyproject.toml", kind="toml-dep-group", group="dev"
        ),
    ),
)


def _extract(repo_root: Path, source: SeamSource, package: str) -> str | None:
    path = repo_root / source.file
    if not path.is_file():
        return None
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None  # read/decode failure → NEEDS_MANUAL_REVIEW
    if source.kind == "yaml-regex":
        return extract_yaml_pin(text, package)
    if source.kind == "toml-dep-group":
        return extract_toml_pin(text, package, source.group)
    return None


def _judge(seam: ConfigSeam, va: str | None, vb: str | None) -> ConfigFinding:
    if va is None or vb is None:
        return ConfigFinding(
            seam.name,
            va,
            vb,
            "NEEDS_MANUAL_REVIEW",
            f"명세 추출 실패 (a={va!r}, b={vb!r})",
        )
    ca, cb = parse_specifier(va), parse_specifier(vb)
    if ca is None or cb is None:
        return ConfigFinding(
            seam.name,
            va,
            vb,
            "NEEDS_MANUAL_REVIEW",
            f"미지원 연산자 (a={va!r}, b={vb!r})",
        )
    if is_satisfiable(ca + cb):
        return ConfigFinding(
            seam.name,
            va,
            vb,
            "CONFIG_CONSISTENT",
            f"{seam.package} {va} ∧ {vb}: 교집합 비공집합",
        )
    return ConfigFinding(
        seam.name,
        va,
        vb,
        "CONFIG_SEAM_MISMATCH",
        f"{seam.package} {va} ∧ {vb}: 교집합 공집합",
    )


def evaluate(repo_root: Path) -> list[ConfigFinding]:
    """Evaluate every declared config-seam against files under *repo_root*."""
    findings: list[ConfigFinding] = []
    for seam in SEAMS:
        va = _extract(repo_root, seam.source_a, seam.package)
        vb = _extract(repo_root, seam.source_b, seam.package)
        findings.append(_judge(seam, va, vb))
    return findings
