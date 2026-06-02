// @ts-check
//
// ESLint 9.x flat config for the `core-ts` TypeScript library workspace.
//
// Division of labour (Phase 6.4): ESLint owns bug-catching, Prettier owns
// formatting. `eslint-config-prettier` is applied LAST so every stylistic
// rule that could fight Prettier is switched off — zero rule overlap.
//
// Base ruleset is typescript-eslint's *syntax-only* `recommended` (NOT
// `recommended-type-checked`). Type-aware linting is expensive, so we cherry
// pick only four high-signal type-checked rules and scope the costly
// `parserOptions.project` wiring to the override block that needs it.
//
// No React plugins: core-ts is a pure TS library with no JSX.
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    // Generated / vendored output is never linted.
    ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
  },

  // Base: syntax-only recommended rules across all TS source. No type
  // information required here, so this stays fast.
  ...tseslint.configs.recommended,

  // Honour the project's `_`-prefix convention for intentionally-unused
  // bindings (e.g. destructured positional params in `test.each` rows).
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  // Type-checked override block. `parserOptions.project` is scoped to THIS
  // block only (per Seed constraint) so the rest of the config never pays
  // the type-information cost. Exactly four cherry-picked type-aware rules,
  // all as `error`.
  //
  // Scoped to `src/**` only — mirroring the Python parity bar where
  // `mypy --strict` runs against `src` alone (`files = ["src"]`) while the
  // basic linter (ruff E/F/W ≈ syntax-only recommended) also covers tests.
  // Test files therefore get the syntax-only base ruleset but not the
  // type-aware rules (whose view of `vi.fn()` mock types diverges from the
  // production `tsc` program).
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
    },
  },

  // MUST be last: disables all ESLint formatting rules that would otherwise
  // conflict with Prettier. Prettier owns formatting exclusively.
  prettier,
);
