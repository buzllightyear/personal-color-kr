/**
 * Moat-rework invariant — Sub-AC 13a: ToneSwitcher 제거 검증.
 *
 * Asserts that all tone-switcher enum declarations, ToneSwitcher
 * identifiers, import references, and tone-conditional branches
 * have been deleted from the source tree.
 * A match in any non-doc source file is a regression.
 *
 * Sub-AC 13a requirements:
 *   1. ToneSwitcher enum 정의 (enum definitions) = 0
 *   2. ToneSwitcher import 참조 (import references) = 0
 *   3. ToneSwitcher 분기(if/switch/match) 참조 (branch references) = 0
 *
 * Patterns checked (code identifiers, not prose text):
 *   - ToneSwitcher       — the deleted UI component
 *   - ToneStateProvider  — the deleted global state provider
 *   - useToneState       — the deleted hook
 *   - ToneSource         — the deleted 'diagnosis-default'|'user-switched' type
 *   - trackToneSwitched  — the deleted analytics helper
 *   - TONE_SWITCHED_EVENT_NAME — the deleted event-name constant
 *   - track-tone-switched — the deleted module reference
 *
 * Additional branch/import patterns checked:
 *   - import.*ToneSwitcher  — any import of the deleted component
 *   - switch(toneState)     — switch statements branching on tone state
 *   - case 'diagnosis-default'|'user-switched' — ToneSource enum values as branches
 *   - === '에디토리얼' etc. — equality comparisons against legacy tone strings
 *
 * Scope: `apps/mobile/src` + `apps/mobile/app` (production code only).
 * `apps/mobile/tests` and `docs/` are intentionally excluded —
 * tests contain these strings as pattern literals, docs contain
 * historical plan records of removed phases.
 */
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

// ---------------------------------------------------------------------------
// Source-only paths (exclude tests/ and docs/ to avoid false positives from
// pattern literal strings and historical documentation).
// ---------------------------------------------------------------------------
const SOURCE_PATHS = [
  'apps/mobile/src',
  'apps/mobile/app',
] as const;

/**
 * Run git grep against tracked files in the given paths.
 * Returns the list of matching file paths (empty = no match = desired).
 */
function grepTrackedFiles(pattern: string, paths: readonly string[]): string[] {
  let raw: string;
  try {
    raw = execSync(
      `git grep -l '${pattern}' -- ${paths.join(' ')}`,
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
  } catch {
    // git grep exits non-zero when no matches found — that is the desired
    // outcome (0 matches). Return an empty array.
    return [];
  }
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Scan source files on disk (not just tracked) for a regex pattern.
 * Returns list of files with matches.
 */
function scanFilesForPattern(pattern: RegExp, directories: readonly string[]): string[] {
  const matches: string[] = [];

  function walkDir(dir: string): void {
    const absDir = path.join(REPO_ROOT, dir);
    if (!fs.existsSync(absDir)) return;
    const entries = fs.readdirSync(absDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(absDir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        walkDir(path.join(dir, entry.name));
      } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        if (pattern.test(content)) {
          matches.push(path.join(dir, entry.name));
        }
      }
    }
  }

  for (const dir of directories) {
    walkDir(dir);
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Dead-code identifier patterns (Sub-AC 13a: identifier removal verification)
// ---------------------------------------------------------------------------
const DEAD_CODE_IDENTIFIERS = [
  'ToneSwitcher',
  'ToneStateProvider',
  'useToneState',
  'ToneSource',
  'trackToneSwitched',
  'TONE_SWITCHED_EVENT_NAME',
  'track-tone-switched',
] as const;

// ---------------------------------------------------------------------------
// Sub-AC 13a §1 — Enum definition patterns
// Checks that no TypeScript enum or type alias defining the old 4-tone set
// survives in source code.
// ---------------------------------------------------------------------------
const ENUM_DEFINITION_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  {
    label: 'enum ToneSwitcher definition',
    regex: /\benum\s+ToneSwitcher\b/,
  },
  {
    label: 'type ToneSource definition',
    regex: /\btype\s+ToneSource\b\s*=/,
  },
  {
    label: 'ToneStateProvider type/interface definition',
    regex: /\b(type|interface)\s+ToneStateProvider\b/,
  },
];

// ---------------------------------------------------------------------------
// Sub-AC 13a §2 — Import reference patterns
// Checks that no file imports the deleted ToneSwitcher-family symbols.
// ---------------------------------------------------------------------------
const IMPORT_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  {
    label: 'import ToneSwitcher component',
    regex: /import\s+[^;]*\bToneSwitcher\b[^;]*from/,
  },
  {
    label: 'import ToneStateProvider',
    regex: /import\s+[^;]*\bToneStateProvider\b[^;]*from/,
  },
  {
    label: 'import useToneState hook',
    regex: /import\s+[^;]*\buseToneState\b[^;]*from/,
  },
  {
    label: 'import trackToneSwitched',
    regex: /import\s+[^;]*\btrackToneSwitched\b[^;]*from/,
  },
  {
    label: 'import from track-tone-switched module',
    regex: /from\s+['"].*track-tone-switched['"]/,
  },
];

// ---------------------------------------------------------------------------
// Sub-AC 13a §3 — Branch (if/switch/match) patterns
// Checks that no code branches on ToneSwitcher-specific state.
//
// NOTE: The result wording catalog legitimately uses Korean wording-tone
// labels (에디토리얼, 다정한, 유쾌한, 시적인) as DATA VALUES in a lookup table.
// These are NOT ToneSwitcher branch patterns — they are WordingTone display
// labels (a separate, retained concept). We therefore check for
// ToneSwitcher-specific branch markers:
//   - switch() expressions whose subject is a tone *state* variable
//   - case labels for ToneSource enum values ('diagnosis-default', 'user-switched')
//   - legacy tone strings used as CASE labels (not data values)
// ---------------------------------------------------------------------------
const BRANCH_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  {
    // switch statements where the subject references tone state (toneState,
    // currentTone, tone.current, etc.) — ToneSwitcher branching pattern.
    // Data-value assignments like `editorial: '에디토리얼'` do not match.
    label: 'switch statement on tone state variable (e.g. switch(toneState.current))',
    regex: /\bswitch\s*\(\s*[^)]*\b(toneState|currentTone|tone\.current|activeTone)\b[^)]*\)/,
  },
  {
    // ToneSource enum values used as case labels — 'diagnosis-default' and
    // 'user-switched' were the two values of the deleted ToneSource type.
    label: "case 'diagnosis-default' — deleted ToneSource enum value as branch label",
    regex: /\bcase\s+['"`]diagnosis-default['"`]/,
  },
  {
    label: "case 'user-switched' — deleted ToneSource enum value as branch label",
    regex: /\bcase\s+['"`]user-switched['"`]/,
  },
  {
    // if/else or ternary comparing a variable *to* the legacy Korean tone strings
    // (as opposed to assigning them as display labels).
    // Pattern: `=== '에디토리얼'` or `!== '다정한'` etc.
    label: 'equality comparison against legacy Korean tone string (=== / !==)',
    regex: /[!=]==\s*['"`](다정|다정한|에디토리얼|유쾌|유쾌한|시적|시적인)['"`]/,
  },
];

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('Sub-AC 13a §0: ToneSwitcher identifier dead-code removal (git tracked files)', () => {
  it.each(DEAD_CODE_IDENTIFIERS)(
    'git grep for "%s" finds 0 matches in apps/mobile/src + app',
    (pattern) => {
      const matches = grepTrackedFiles(pattern, SOURCE_PATHS);
      expect(
        matches,
        `Dead-code identifier "${pattern}" found in: ${matches.join(', ')}. Remove all references.`,
      ).toEqual([]);
    },
  );
});

describe('Sub-AC 13a §1: ToneSwitcher enum 정의 = 0 (no enum/type definitions)', () => {
  it.each(ENUM_DEFINITION_PATTERNS.map(p => [p.label, p.regex]))(
    '%s — 0 files in apps/mobile/src + app contain this pattern',
    (label, regex) => {
      const matches = scanFilesForPattern(regex as RegExp, SOURCE_PATHS);
      expect(
        matches,
        `Enum definition pattern "${label}" found in: ${matches.join(', ')}. Delete these definitions.`,
      ).toEqual([]);
    },
  );
});

describe('Sub-AC 13a §2: ToneSwitcher import 참조 = 0 (no import references)', () => {
  it.each(IMPORT_PATTERNS.map(p => [p.label, p.regex]))(
    '%s — 0 files in apps/mobile/src + app contain this import',
    (label, regex) => {
      const matches = scanFilesForPattern(regex as RegExp, SOURCE_PATHS);
      expect(
        matches,
        `Import pattern "${label}" found in: ${matches.join(', ')}. Remove these imports.`,
      ).toEqual([]);
    },
  );
});

describe('Sub-AC 13a §3: ToneSwitcher 분기(if/switch/match) 참조 = 0 (no branch references)', () => {
  it.each(BRANCH_PATTERNS.map(p => [p.label, p.regex]))(
    '%s — 0 files in apps/mobile/src + app contain this branch',
    (label, regex) => {
      const matches = scanFilesForPattern(regex as RegExp, SOURCE_PATHS);
      expect(
        matches,
        `Branch pattern "${label}" found in: ${matches.join(', ')}. Remove tone-conditional branches.`,
      ).toEqual([]);
    },
  );
});
