// @ts-check
//
// ESLint 9.x flat config for the `web` Next.js workspace.
//
// Mirrors apps/mobile/eslint.config.mjs so the monorepo lints with one
// consistent toolchain (typescript-eslint syntax-only recommended + react +
// react-hooks, Prettier last). We deliberately do NOT use `next lint`, which
// is deprecated in Next 15 and prompts interactively when no legacy
// `.eslintrc` is present — that prompt hangs CI (`pnpm -r run lint`).
//
// Division of labour: ESLint owns bug-catching, Prettier owns formatting.
// `eslint-config-prettier` is applied LAST so no stylistic rule fights Prettier.
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    // Generated / vendored output is never linted.
    ignores: ['.next/**', 'out/**', 'dist/**', 'coverage/**', 'node_modules/**'],
  },

  // Base: syntax-only recommended rules across all TS/TSX source.
  ...tseslint.configs.recommended,

  // Honour the project's `_`-prefix convention for intentionally-unused
  // bindings.
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

  // React recommended rules for the JSX surface.
  {
    files: ['**/*.{ts,tsx}'],
    ...react.configs.flat.recommended,
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      // The new JSX transform (React 17+/Next) does not require React in scope.
      'react/react-in-jsx-scope': 'off',
      // TypeScript's prop types supersede PropTypes runtime validation.
      'react/prop-types': 'off',
    },
  },

  // React Hooks: rules-of-hooks is a hard error; exhaustive-deps is a WARN
  // only so a missing dependency never blocks CI.
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // Test files legitimately cast partial mocks through `any`.
  {
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // MUST be last: disables all ESLint formatting rules that conflict with
  // Prettier. Prettier owns formatting exclusively.
  prettier,
);
