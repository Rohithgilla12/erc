import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decryptToken, encryptToken } from './strava-crypto'

describe('strava-crypto token encryption', () => {
  const originalSecret = process.env.PAYLOAD_SECRET

  beforeEach(() => {
    process.env.PAYLOAD_SECRET = 'test-payload-secret-1234567890'
  })

  afterEach(() => {
    if (originalSecret !== undefined) {
      process.env.PAYLOAD_SECRET = originalSecret
    } else {
      delete process.env.PAYLOAD_SECRET
    }
  })

  it('encrypts and decrypts a plain text token correctly (roundtrip)', () => {
    const token = 'strava_access_token_abc123xyz'
    const encrypted = encryptToken(token)

    expect(encrypted).not.toBe(token)
    expect(encrypted.split(':')).toHaveLength(3)

    const decrypted = decryptToken(encrypted)
    expect(decrypted).toBe(token)
  })

  it('handles empty strings and unicode / complex characters', () => {
    const complex = 'token-with-special-chars-🚀-£-€-123!@#$%^&*()'
    const encrypted = encryptToken(complex)
    expect(decryptToken(encrypted)).toBe(complex)

    const empty = ''
    const encryptedEmpty = encryptToken(empty)
    expect(decryptToken(encryptedEmpty)).toBe(empty)
  })

  it('generates unique ciphertexts for identical plaintexts (random IV)', () => {
    const token = 'same-token-content'
    const enc1 = encryptToken(token)
    const enc2 = encryptToken(token)

    expect(enc1).not.toBe(enc2)
    expect(decryptToken(enc1)).toBe(token)
    expect(decryptToken(enc2)).toBe(token)
  })

  it('throws an error if PAYLOAD_SECRET is missing during encryption or decryption', () => {
    delete process.env.PAYLOAD_SECRET

    expect(() => encryptToken('some-token')).toThrow('PAYLOAD_SECRET is required for token encryption')
    expect(() => decryptToken('01:02:03')).toThrow('PAYLOAD_SECRET is required for token encryption')
  })

  it('rejects invalid ciphertext formats that do not have 3 colon-separated parts', () => {
    expect(() => decryptToken('')).toThrow('Invalid encrypted token format')
    expect(() => decryptToken('onlyonepart')).toThrow('Invalid encrypted token format')
    expect(() => decryptToken('two:parts')).toThrow('Invalid encrypted token format')
    expect(() => decryptToken('four:parts:here:extra')).toThrow('Invalid encrypted token format')
  })

  it('fails decryption when ciphertext is tampered with', () => {
    const encrypted = encryptToken('valid-token')
    const [ivHex, tagHex, contentHex] = encrypted.split(':')

    // Tamper the ciphertext content
    const tamperedContent = contentHex.slice(0, -2) + (contentHex.slice(-2) === 'aa' ? 'bb' : 'aa')
    const tampered = `${ivHex}:${tagHex}:${tamperedContent}`

    expect(() => decryptToken(tampered)).toThrow()
  })

  it('fails decryption when authentication tag is tampered with', () => {
    const encrypted = encryptToken('valid-token')
    const [ivHex, tagHex, contentHex] = encrypted.split(':')

    // Tamper the auth tag
    const tamperedTag = (tagHex.slice(0, 2) === '00' ? '11' : '00') + tagHex.slice(2)
    const tampered = `${ivHex}:${tamperedTag}:${contentHex}`

    expect(() => decryptToken(tampered)).toThrow()
  })

  it('fails decryption if encrypted with a different PAYLOAD_SECRET', () => {
    const encrypted = encryptToken('secret-token')
    process.env.PAYLOAD_SECRET = 'different-secret-0987654321'

    expect(() => decryptToken(encrypted)).toThrow()
  })
})
