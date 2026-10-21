'use client'

import React, { useActionState } from 'react'

import type { ProfileFormState } from '@/members/actions'

export type FormField =
  | { kind: 'hidden'; name: string; value: string }
  | { kind: 'text' | 'year'; name: string; label: string; hint?: string; required?: boolean; maxLength?: number }
  | { kind: 'textarea'; name: string; label: string; hint?: string; required?: boolean; maxLength?: number }
  | { kind: 'select'; name: string; label: string; hint?: string; required?: boolean; options: readonly { value: string; label: string }[] }
  | { kind: 'file'; name: string; label: string; hint?: string; required?: boolean; accept: string }

type Props = {
  /** Also the fragment the form posts back to with JavaScript off. */
  id: string
  action: (state: ProfileFormState, form: FormData) => Promise<ProfileFormState>
  fields: readonly FormField[]
  initial: Readonly<Record<string, string>>
  submit: string
}

const errorId = (form: string, field: string) => `${form}-${field}-error`

/** One athlete form, described as data so the page can lay out several without a component each. */
export function ProfileForm({ id, action, fields, initial, submit }: Props) {
  const [state, formAction, pending] = useActionState(action, { values: initial }, `/me/athlete#${id}`)
  const valueOf = (name: string) => state.values[name] ?? initial[name] ?? ''

  return (
    <form className="member-form" id={id} action={formAction}>
      {state.saved ? (
        <p className="member-saved" role="status">
          {state.saved}
        </p>
      ) : null}
      {state.notice ? (
        <p className="member-alert" role="alert">
          {state.notice}
        </p>
      ) : null}
      {fields.map((field) => {
        if (field.kind === 'hidden') return <input key={field.name} type="hidden" name={field.name} value={field.value} />
        const message = state.errors?.[field.name]
        const invalid = message ? { 'aria-invalid': true as const, 'aria-describedby': errorId(id, field.name) } : {}
        const common = { name: field.name, required: field.required, defaultValue: valueOf(field.name), ...invalid }
        return (
          <label className="member-field" key={field.name}>
            <span>{field.label}</span>
            {field.kind === 'file' ? (
              <input type="file" name={field.name} accept={field.accept} required={field.required} {...invalid} />
            ) : field.kind === 'textarea' ? (
              <textarea rows={4} maxLength={field.maxLength} {...common} />
            ) : field.kind === 'select' ? (
              <select {...common}>
                {valueOf(field.name) === '' ? <option value="">Choose</option> : null}
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input type="text" inputMode={field.kind === 'year' ? 'numeric' : undefined} maxLength={field.kind === 'year' ? 4 : field.maxLength} {...common} />
            )}
            {field.hint ? <span className="member-hint">{field.hint}</span> : null}
            {message ? (
              <span className="member-error" id={errorId(id, field.name)}>
                {message}
              </span>
            ) : null}
          </label>
        )
      })}
      <div className="member-row">
        <button className="button" type="submit" disabled={pending}>
          {pending ? 'Saving…' : submit}
        </button>
      </div>
    </form>
  )
}
