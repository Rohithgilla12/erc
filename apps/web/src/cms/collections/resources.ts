import path from 'node:path'

import type { ResourceCategory } from '@erc/domain'
import { ValidationError, type CollectionBeforeOperationHook, type UploadConfig } from 'payload'

import { staffOf } from '../access'
import { accessField, seoField, slugField } from '../editorial-fields'
import { optionsFrom } from '../fields'
import { defineEditorial } from '../kinds'

declare module 'payload' {
  interface RequestContext {
    /** Set only by `/downloads/[slug]` after it has checked access, on a request it builds in-process. */
    resourceDownload?: true
  }
}

export const RESOURCE_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'text/csv',
]

export const MAX_RESOURCE_BYTES = 20 * 1024 * 1024

const CATEGORY_LABELS: Record<ResourceCategory, string> = {
  'plan-pdf': 'Plan PDF',
  checklist: 'Checklist',
  guide: 'Guide',
  spreadsheet: 'Spreadsheet',
}

type UploadHandler = NonNullable<UploadConfig['handlers']>[number]

/**
 * Payload's file route serves any published file to anyone. `/downloads/[slug]` must stay the only public door, so
 * that Phase 3 can refuse a paid file in one place; staff still preview files in the admin.
 */
const onlyStaffOrDownloadRoute: UploadHandler = (req) => {
  if (staffOf(req) || req.context.resourceDownload) return
  return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
}

const limitFileSize: CollectionBeforeOperationHook = ({ args, operation, req }) => {
  if ((operation === 'create' || operation === 'update') && req.file && req.file.size > MAX_RESOURCE_BYTES) {
    throw new ValidationError({
      errors: [{ path: 'file', message: `Files can be at most ${MAX_RESOURCE_BYTES / 1024 / 1024} MB. This one is ${(req.file.size / 1024 / 1024).toFixed(1)} MB.` }],
    })
  }
  return args
}

export const Resources = defineEditorial({
  slug: 'resources',
  labels: { singular: 'Download', plural: 'Downloads' },
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'category', 'filename', '_status'] },
  upload: {
    mimeTypes: RESOURCE_MIME_TYPES,
    // Without R2, files land beside media on the same volume, in their own folder so names never collide with images.
    staticDir: path.join(process.env.MEDIA_DIR || 'media', 'resources'),
    handlers: [onlyStaffOrDownloadRoute],
  },
  hooks: { beforeOperation: [limitFileSize] },
  fields: [
    { name: 'title', type: 'text', required: true },
    slugField,
    { name: 'description', type: 'textarea', required: true },
    { name: 'category', label: 'Kind', type: 'select', required: true, options: optionsFrom(CATEGORY_LABELS) },
    accessField,
    seoField,
  ],
})
