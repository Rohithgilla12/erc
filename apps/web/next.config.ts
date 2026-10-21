import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(__filename)
// Workspace packages live outside this app, so tracing and Turbopack must see the whole monorepo.
const monorepoRoot = path.resolve(dirname, '../..')

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: monorepoRoot,
  transpilePackages: ['@erc/contract', '@erc/domain'],
  // A member's photo is posted through a server action; the domain refuses anything over 5 MB with a message.
  experimental: { serverActions: { bodySizeLimit: '6mb' } },
  images: {
    localPatterns: [
      {
        pathname: '/api/media/file/**',
      },
    ],
  },
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.cjs': ['.cts', '.cjs'],
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }

    return webpackConfig
  },
  turbopack: {
    root: monorepoRoot,
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
