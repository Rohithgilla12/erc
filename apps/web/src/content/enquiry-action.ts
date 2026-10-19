'use server'

import { headers } from 'next/headers'

import { receiveEnquiry, type EnquiryFormState } from './enquiries'

export async function submitEnquiry(_previous: EnquiryFormState, form: FormData): Promise<EnquiryFormState> {
  const fields: Record<string, string> = {}
  for (const [key, value] of form) {
    if (typeof value === 'string' && !(key in fields)) fields[key] = value
  }
  return receiveEnquiry(fields, await headers())
}
