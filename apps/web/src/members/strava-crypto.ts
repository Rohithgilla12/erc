import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const SALT = 'erc-strava-encryption-salt'
const IV_LENGTH = 12

let cachedSecret: string | undefined
let cachedKey: Buffer | undefined

function getKey(): Buffer {
  const secret = process.env.PAYLOAD_SECRET
  if (!secret) throw new Error('PAYLOAD_SECRET is required for token encryption')
  if (cachedKey && secret === cachedSecret) {
    return cachedKey
  }
  cachedSecret = secret
  cachedKey = scryptSync(secret, SALT, 32)
  return cachedKey
}

export function encryptToken(text: string): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, getKey(), iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decryptToken(encryptedString: string): string {
  const parts = encryptedString.split(':')
  if (parts.length !== 3) throw new Error('Invalid encrypted token format')
  const [ivHex, tagHex, contentHex] = parts
  const iv = Buffer.from(ivHex, 'hex')
  const tag = Buffer.from(tagHex, 'hex')
  const content = Buffer.from(contentHex, 'hex')

  const decipher = createDecipheriv(ALGORITHM, getKey(), iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(content), decipher.final()])
  return decrypted.toString('utf8')
}

export function signOAuthState(memberId: number, secret = process.env.PAYLOAD_SECRET): string {
  if (!secret) throw new Error('PAYLOAD_SECRET is required to sign OAuth state')
  const hmac = createHmac('sha256', secret).update(memberId.toString()).digest('hex')
  return `${memberId}.${hmac}`
}

export function verifyOAuthState(state: string, expectedMemberId: number, secret = process.env.PAYLOAD_SECRET): boolean {
  if (!secret || !state) return false
  const dotIndex = state.indexOf('.')
  if (dotIndex === -1) return false
  const memberIdStr = state.slice(0, dotIndex)
  const signature = state.slice(dotIndex + 1)
  if (!memberIdStr || !signature) return false
  if (Number(memberIdStr) !== expectedMemberId) return false

  const expectedHmac = createHmac('sha256', secret).update(memberIdStr).digest('hex')
  const sigBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expectedHmac)
  if (sigBuffer.length !== expectedBuffer.length) return false
  return timingSafeEqual(sigBuffer, expectedBuffer)
}
