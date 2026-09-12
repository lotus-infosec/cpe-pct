// ESLint flat config. Two rules matter here and are non-negotiable (see SECURITY.md / README):
//  1. src/core is pure: it may import only from src/core and src/ports.
//  2. Nothing in src may call db.transaction(); D1 has no interactive transactions. Use db.batch().
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

const coreForbiddenImports = [
  {
    group: ['**/adapters/**', '**/app/**', '**/db/**'],
    message: 'src/core may import only from src/core and src/ports.',
  },
  {
    group: ['@cloudflare/*', 'cloudflare:*'],
    message: 'src/core must not depend on Cloudflare types. Add a port.',
  },
  { group: ['node:*'], message: 'src/core must not depend on Node builtins. Add a port.' },
  {
    group: ['drizzle-orm', 'drizzle-orm/*'],
    message: 'src/core must not depend on the ORM. The app layer loads plain objects.',
  },
];

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'web/dist/**',
      '.wrangler/**',
      'src/db/migrations/**',
      'CPETracker/**',
      'worker-configuration.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: coreForbiddenImports }],
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.property.name="transaction"]',
          message:
            'db.transaction() is forbidden (D1 has no interactive transactions). Use db.batch([...]).',
        },
      ],
    },
  },
);
