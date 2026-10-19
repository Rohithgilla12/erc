import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^(_|ignore)',
        },
      ],
    },
  },
  {
    // Public pages read through src/content, which maps CMS documents to @erc/domain types.
    files: ['src/app/(frontend)/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'payload', message: 'Read through src/content instead.' }],
          patterns: [{ group: ['@payloadcms/*', '@/cms/*', '@/payload.config'], message: 'Read through src/content instead.' }],
        },
      ],
    },
  },
  globalIgnores(['.next/', 'src/payload-types.ts', 'src/migrations/', 'src/app/(payload)/']),
])
