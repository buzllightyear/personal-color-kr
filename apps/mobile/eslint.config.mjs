// @ts-check
//
// ESLint 9.x flat config for the `mobile` React Native (Expo) workspace.
//
// Division of labour (Phase 6.4): ESLint owns bug-catching, Prettier owns
// formatting. `eslint-config-prettier` is applied LAST so every stylistic
// rule that could fight Prettier is switched off — zero rule overlap.
//
// Base ruleset is typescript-eslint's *syntax-only* `recommended` (NOT
// `recommended-type-checked`). We add `eslint-plugin-react` (recommended)
// and `eslint-plugin-react-hooks` for this RN UI workspace. We deliberately
// do NOT add `eslint-plugin-react-native` (out of scope for Phase 6.4).
//
// Type-aware linting is scoped to a single override block: only four
// high-signal type-checked rules are enabled, and the costly
// `parserOptions.project` wiring lives in that block alone.
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    // Generated / vendored output is never linted.
    ignores: ['.expo/**', 'dist/**', 'build/**', 'coverage/**', 'node_modules/**'],
  },

  // Base: syntax-only recommended rules across all TS/TSX source.
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

  // React recommended rules for the JSX surface (apps/mobile only).
  {
    files: ['**/*.{ts,tsx}'],
    ...react.configs.flat.recommended,
    settings: {
      react: {
        // RN ships its own React; let the plugin detect the installed version.
        version: 'detect',
      },
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      // The new JSX transform (React 17+/RN) does not require React in scope.
      'react/react-in-jsx-scope': 'off',
      // TypeScript's prop types supersede PropTypes runtime validation.
      'react/prop-types': 'off',
    },
  },

  // React Hooks: rules-of-hooks is a hard error; exhaustive-deps is a WARN
  // only (per Seed constraint) so a missing dependency never blocks CI.
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // Type-checked override block. `parserOptions.project` is scoped to THIS
  // block only (per Seed constraint). Exactly four cherry-picked type-aware
  // rules, all as `error`.
  // Scoped to production `app/**` + `src/**` only — mirroring the Python
  // parity bar where `mypy --strict` runs against `src` alone
  // (`files = ["src"]`) while the basic linter (ruff E/F/W ≈ syntax-only
  // recommended) also covers tests. Test files therefore get the syntax-only
  // base ruleset but not the type-aware rules (whose view of `vi.fn()` mock
  // types diverges from the production `tsc` program, and whose `.tsx` test
  // files are not even part of the reused `tsconfig.json` `include`).
  {
    files: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
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

  // Test files legitimately cast partial mocks of native modules
  // (Superwall, AsyncStorage, expo-router) through `any`. This mirrors the
  // Python parity bar where `mypy --strict` is scoped to `src` only
  // (`files = ["src"]`), not the test tree — production code stays strict,
  // test scaffolding is exempt from `no-explicit-any`.
  {
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // MUST be last: disables all ESLint formatting rules that would otherwise
  // conflict with Prettier. Prettier owns formatting exclusively.
  prettier,
);
