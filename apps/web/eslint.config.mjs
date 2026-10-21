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
    // They navigate with plain <a> so every navigation is a full page load: identical with JavaScript off, and
    // eligible for cross-document view transitions, which client-side <Link> navigations skip.
    files: ['src/app/(frontend)/**/*.{ts,tsx}'],
    rules: {
      '@next/next/no-html-link-for-pages': 'off',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'payload', message: 'Read through src/content instead.' },
            { name: 'next/link', message: 'Use a plain <a>; public pages navigate with full page loads.' },
          ],
          patterns: [
            {
              group: ['@payloadcms/**', '@/cms', '@/cms/**', '@/payload.config', '@/payload-types', '@/migrations', '@/migrations/**'],
              message: 'Read through src/content instead.',
            },
            {
              group: ['@/members/**', '!@/members/run', '!@/members/actions'],
              message: 'Pages and forms act on members only through run.ts and actions.ts, so the dashboard and the API stay one code path.',
            },
          ],
        },
      ],
    },
  },
  globalIgnores(['.next/', 'src/payload-types.ts', 'src/migrations/', 'src/app/(payload)/']),
])
