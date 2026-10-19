import { describe, expect, it } from 'vitest'
import { ENQUIRY_TOPICS, parseEnquiry, parseEnquiryTopic } from './index'

const valid = {
  name: '  Asha\n  Rao ',
  email: ' asha@example.com ',
  phone: '+91 98765 43210',
  topic: 'coaching',
  message: '  I would like help preparing for my first half marathon.  ',
  consent: 'on',
}

const errorsOf = (input: Record<string, unknown>) => {
  const result = parseEnquiry(input)
  return result.ok ? {} : result.error
}

describe('parseEnquiry', () => {
  it('builds an enquiry from a complete form, trimmed and with the name on one line', () => {
    expect(parseEnquiry(valid)).toEqual({
      ok: true,
      value: {
        name: 'Asha Rao',
        email: 'asha@example.com',
        phone: '+91 98765 43210',
        topic: 'coaching',
        message: 'I would like help preparing for my first half marathon.',
        consent: true,
      },
    })
  })

  it('treats an empty phone as no phone', () => {
    const result = parseEnquiry({ ...valid, phone: '   ' })
    expect(result.ok && result.value.phone).toBe(null)
  })

  it('takes the first value of a repeated field', () => {
    const result = parseEnquiry({ ...valid, topic: ['partnership', 'coaching'] })
    expect(result.ok && result.value.topic).toBe('partnership')
  })

  it('refuses an enquiry without consent, whatever else is sent', () => {
    for (const consent of [undefined, '', 'off', 'false', 'yes please']) {
      expect(Object.keys(errorsOf({ ...valid, consent }))).toEqual(['consent'])
    }
  })

  it('accepts each checkbox spelling of consent', () => {
    for (const consent of ['on', 'true', '1']) expect(parseEnquiry({ ...valid, consent }).ok).toBe(true)
  })

  it('reports every bad field at once, keyed by field name', () => {
    expect(errorsOf({ phone: 'call me', topic: 'sponsorship', message: 'hi' })).toEqual({
      name: 'Enter your name.',
      email: 'Enter an email address such as name@example.com.',
      phone: 'Enter a phone number such as +91 98765 43210, or leave it empty.',
      topic: 'Choose what your message is about.',
      message: 'Use 10 to 4000 characters for your message.',
      consent: 'Tick the box so we may reply to you.',
    })
  })

  it('bounds the name and message by characters, not UTF-16 units', () => {
    expect(parseEnquiry({ ...valid, name: '🏃'.repeat(120) }).ok).toBe(true)
    expect(Object.keys(errorsOf({ ...valid, name: '🏃'.repeat(121) }))).toEqual(['name'])
    expect(parseEnquiry({ ...valid, message: 'x'.repeat(4000) }).ok).toBe(true)
    expect(Object.keys(errorsOf({ ...valid, message: 'x'.repeat(4001) }))).toEqual(['message'])
  })

  it('needs 7 to 15 digits in a phone number', () => {
    expect(parseEnquiry({ ...valid, phone: '040 1234' }).ok).toBe(true)
    expect(Object.keys(errorsOf({ ...valid, phone: '12345' }))).toEqual(['phone'])
    expect(Object.keys(errorsOf({ ...valid, phone: '+1 234 567 890 123 456' }))).toEqual(['phone'])
  })

  it('rejects an address without a domain', () => {
    expect(Object.keys(errorsOf({ ...valid, email: 'asha@example' }))).toEqual(['email'])
  })
})

describe('parseEnquiryTopic', () => {
  it('knows every listed topic and nothing else', () => {
    for (const { key } of ENQUIRY_TOPICS) expect(parseEnquiryTopic(key)).toBe(key)
    expect(parseEnquiryTopic('Coaching')).toBe(null)
    expect(parseEnquiryTopic('constructor')).toBe(null)
  })
})
