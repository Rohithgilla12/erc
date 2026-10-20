'use server'

import { headers } from 'next/headers'

import { receiveEnquiry, type EnquiryFormState } from './enquiries'
import { fieldsOf } from './form-fields'

export async function submitEnquiry(_previous: EnquiryFormState, form: FormData): Promise<EnquiryFormState> {
  return receiveEnquiry(fieldsOf(form), await headers())
}
