import type { StaffRole } from '@erc/domain'

import { isAdmin, isAdminOrSelf } from '../access'
import { optionsFrom } from '../fields'
import { defineRecord } from '../kinds'

export const Staff = defineRecord({
  slug: 'staff',
  visibility: 'private',
  auth: true,
  admin: { useAsTitle: 'email', defaultColumns: ['email', 'role'] },
  access: { create: isAdmin, delete: isAdmin, update: isAdminOrSelf },
  fields: [
    {
      name: 'role',
      type: 'select',
      required: true,
      saveToJWT: true,
      options: optionsFrom<StaffRole>({ admin: 'Admin', editor: 'Editor', author: 'Author' }),
      // Without this an author could promote themselves through their own profile.
      access: { update: isAdmin },
    },
  ],
})
