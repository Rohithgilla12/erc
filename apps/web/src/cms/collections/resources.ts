import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { RESOURCE_CATEGORY_LABELS, RESOURCE_FILE_TYPES } from '@erc/domain'
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

const MAX_RESOURCE_BYTES = 20 * 1024 * 1024

type UploadHandler = NonNullable<UploadConfig['handlers']>[number]

/**
 * Payload's file route serves any published file to anyone. `/downloads/[slug]` must stay the only public door, so
 * that Phase 3 can refuse a paid file in one place; staff still preview files in the admin.
 */
const onlyStaffOrDownloadRoute: UploadHandler = (req) => {
  if (staffOf(req) || req.context.resourceDownload) return
  return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
}

/**
 * Refuses oversized files, and stores each file under a random name. With R2 the object sits in the public media
 * bucket (see the design doc's Downloads section), so an unguessable key keeps a draft or withdrawn file from being
 * fetched by guessing its upload name. Readers never see the stored name: `/downloads` names the file after its slug.
 */
const prepareUpload: CollectionBeforeOperationHook = ({ args, operation, req }) => {
  if ((operation !== 'create' && operation !== 'update') || !req.file) return args
  if (req.file.size > MAX_RESOURCE_BYTES) {
    throw new ValidationError({
      errors: [{ path: 'file', message: `Files can be at most ${MAX_RESOURCE_BYTES / 1024 / 1024} MB. This one is ${(req.file.size / 1024 / 1024).toFixed(1)} MB.` }],
    })
  }
  req.file.name = `${randomUUID()}${path.extname(req.file.name).toLowerCase()}`
  return args
}

export const Resources = defineEditorial({
  slug: 'resources',
  labels: { singular: 'Download', plural: 'Downloads' },
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'category', 'mimeType', '_status'] },
  upload: {
    mimeTypes: Object.keys(RESOURCE_FILE_TYPES),
    // Without R2, files land beside media on the same volume, in their own folder so names never collide with images.
    staticDir: path.join(process.env.MEDIA_DIR || 'media', 'resources'),
    handlers: [onlyStaffOrDownloadRoute],
  },
  hooks: { beforeOperation: [prepareUpload] },
  fields: [
    { name: 'title', type: 'text', required: true },
    slugField({ from: 'title' }),
    { name: 'description', type: 'textarea', required: true },
    { name: 'category', label: 'Kind', type: 'select', required: true, options: optionsFrom(RESOURCE_CATEGORY_LABELS) },
    accessField,
    seoField,
  ],
})
