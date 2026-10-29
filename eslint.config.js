import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['node_modules/**', 'dist/**', 'react/dist/**', 'test-results/**', 'playwright-report/**', 'supabase/functions/_shared/core/**', 'supabase/functions/_shared/server/**', '.data/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,jsx}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.worker },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_|^React$', caughtErrors: 'none', destructuredArrayIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'prefer-const': 'error',
    },
  },
  // /core must stay framework- and DOM-agnostic: no browser globals allowed.
  {
    files: ['core/**/*.js'],
    languageOptions: { globals: { ...globals['shared-node-browser'], crypto: 'readonly', TextEncoder: 'readonly' } },
    rules: {
      'no-restricted-globals': ['error', 'document', 'window', 'navigator', 'localStorage', 'indexedDB', 'location', 'requestAnimationFrame'],
    },
  },
  { files: ['tools/**', 'server/**', 'tests/**', '*.config.js', 'react/vite.config.js'], languageOptions: { globals: { ...globals.node } } },
  { files: ['supabase/functions/**'], languageOptions: { globals: { Deno: 'readonly' } } },
  // JSX identifiers count as usage (no React plugin dependency needed).
  { files: ['react/src/**/*.{js,jsx}'], plugins: { 'react-hooks': reactHooks }, rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' } },
  { files: ['react/src/**/*.jsx'], rules: { 'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }] } },
];
