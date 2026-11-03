import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import {
  decryptToken,
  encryptToken,
  signOAuthState,
  verifyOAuthState,
} from './strava-crypto'

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

    assert.notStrictEqual(encrypted, token)
    assert.strictEqual(encrypted.split(':').length, 3)

    const decrypted = decryptToken(encrypted)
    assert.strictEqual(decrypted, token)
  })

  it('handles empty strings and unicode / complex characters', () => {
    const complex = 'token-with-special-chars-🚀-£-€-123!@#$%^&*()'
    const encrypted = encryptToken(complex)
    assert.strictEqual(decryptToken(encrypted), complex)

    const empty = ''
    const encryptedEmpty = encryptToken(empty)
    assert.strictEqual(decryptToken(encryptedEmpty), empty)
  })

  it('generates unique ciphertexts for identical plaintexts (random IV)', () => {
    const token = 'same-token-content'
    const enc1 = encryptToken(token)
    const enc2 = encryptToken(token)

    assert.notStrictEqual(enc1, enc2)
    assert.strictEqual(decryptToken(enc1), token)
    assert.strictEqual(decryptToken(enc2), token)
  })

  it('throws an error if PAYLOAD_SECRET is missing during encryption or decryption', () => {
    delete process.env.PAYLOAD_SECRET

    assert.throws(() => encryptToken('some-token'), {
      message: 'PAYLOAD_SECRET is required for token encryption',
    })
    assert.throws(() => decryptToken('01:02:03'), {
      message: 'PAYLOAD_SECRET is required for token encryption',
    })
  })

  it('rejects invalid ciphertext formats that do not have 3 colon-separated parts', () => {
    assert.throws(() => decryptToken(''), {
      message: 'Invalid encrypted token format',
    })
    assert.throws(() => decryptToken('onlyonepart'), {
      message: 'Invalid encrypted token format',
    })
    assert.throws(() => decryptToken('two:parts'), {
      message: 'Invalid encrypted token format',
    })
    assert.throws(() => decryptToken('four:parts:here:extra'), {
      message: 'Invalid encrypted token format',
    })
  })

  it('fails decryption when ciphertext is tampered with', () => {
    const encrypted = encryptToken('valid-token')
    const [ivHex, tagHex, contentHex] = encrypted.split(':')

    // Tamper the ciphertext content
    const tamperedContent = contentHex.slice(0, -2) + (contentHex.slice(-2) === 'aa' ? 'bb' : 'aa')
    const tampered = `${ivHex}:${tagHex}:${tamperedContent}`

    assert.throws(() => decryptToken(tampered))
  })

  it('fails decryption when authentication tag is tampered with', () => {
    const encrypted = encryptToken('valid-token')
    const [ivHex, tagHex, contentHex] = encrypted.split(':')

    // Tamper the auth tag
    const tamperedTag = (tagHex.slice(0, 2) === '00' ? '11' : '00') + tagHex.slice(2)
    const tampered = `${ivHex}:${tamperedTag}:${contentHex}`

    assert.throws(() => decryptToken(tampered))
  })

  it('fails decryption if encrypted with a different PAYLOAD_SECRET', () => {
    const encrypted = encryptToken('secret-token')
    process.env.PAYLOAD_SECRET = 'different-secret-0987654321'

    assert.throws(() => decryptToken(encrypted))
  })
})

describe('strava-crypto OAuth state', () => {
  const testSecret = 'test-payload-secret-1234567890'
  const memberId = 42

  it('generates valid state signature and round-trip verifies successfully', () => {
    const state = signOAuthState(memberId, testSecret)
    assert.match(state, /^42\.[0-9a-f]{64}$/)
    assert.strictEqual(verifyOAuthState(state, memberId, testSecret), true)
  })

  it('rejects tampered signature', () => {
    const state = signOAuthState(memberId, testSecret)
    const [id, sig] = state.split('.')
    const tamperedSig = sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0')
    const tamperedState = `${id}.${tamperedSig}`

    assert.strictEqual(verifyOAuthState(tamperedState, memberId, testSecret), false)
    assert.strictEqual(verifyOAuthState(state + 'x', memberId, testSecret), false)
  })

  it('rejects mismatched member ID', () => {
    const state = signOAuthState(memberId, testSecret)
    assert.strictEqual(verifyOAuthState(state, 999, testSecret), false)
    assert.strictEqual(verifyOAuthState(state, 0, testSecret), false)
  })

  it('rejects malformed state strings', () => {
    assert.strictEqual(verifyOAuthState('', memberId, testSecret), false)
    assert.strictEqual(verifyOAuthState('nodotstate', memberId, testSecret), false)
    assert.strictEqual(verifyOAuthState('.onlydot', memberId, testSecret), false)
    assert.strictEqual(verifyOAuthState('onlydot.', memberId, testSecret), false)
    assert.strictEqual(verifyOAuthState('abc.signature', memberId, testSecret), false)
    assert.strictEqual(verifyOAuthState('42.', memberId, testSecret), false)
    assert.strictEqual(verifyOAuthState('.123456', memberId, testSecret), false)
  })

  it('rejects missing or empty secret', () => {
    const state = signOAuthState(memberId, testSecret)
    assert.strictEqual(verifyOAuthState(state, memberId, ''), false)
    assert.throws(() => signOAuthState(memberId, ''), {
      message: 'PAYLOAD_SECRET is required to sign OAuth state',
    })
  })
})
