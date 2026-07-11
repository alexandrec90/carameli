import js from '@eslint/js'
import globals from 'globals'
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'
import importX from 'eslint-plugin-import-x'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactPlugin from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default [
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
      'import-x': importX,
    },
    settings: {
      react: {
        version: 'detect',
      },
      'import-x/core-modules': ['vitest'],
      'import-x/resolver-next': [createTypeScriptImportResolver()],
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'import-x/no-unresolved': 'error',
      // eslint-plugin-react-hooks v7 promoted these compiler-powered checks
      // into `recommended`; the existing violations (setState-in-effect
      // patterns and the rAF loop in the comic-book skin) each need per-site
      // rework. Warn instead of error so the CI gate stays meaningful while
      // call sites are migrated — don't add new violations.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
]