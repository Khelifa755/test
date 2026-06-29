import { createHmac, timingSafeEqual } from "node:crypto"
import { env } from "./env"

const SESSION_TTL_MS = 8 * 60 * 60 * 1000
export const ADMIN_SESSION_COOKIE = "kilo_admin_session"

const sign = (payload: string) =>
  createHmac("sha256", env.ADMIN_SESSION_SECRET).update(payload).digest("hex")

export const issueSession = (email: string): { token: string; expiresAt: number; maxAgeSec: number } => {
  const expiresAt = Date.now() + SESSION_TTL_MS
  const payload = `${email}|${expiresAt}`
  const sig = sign(payload)
  return {
    token: `${Buffer.from(payload).toString("base64url")}.${sig}`,
    expiresAt,
    maxAgeSec: Math.floor(SESSION_TTL_MS / 1000),
  }
}

export const verifySession = (
  token: string | undefined,
): { email: string; expiresAt: number } | null => {
  if (!token) return null
  const idx = token.lastIndexOf(".")
  if (idx === -1) return null
  const encodedPayload = token.slice(0, idx)
  const givenSig = token.slice(idx + 1)
  const payload = Buffer.from(encodedPayload, "base64url").toString("utf8")
  const expectedSig = sign(payload)
  const a = Buffer.from(givenSig, "hex")
  const b = Buffer.from(expectedSig, "hex")
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  const sep = payload.lastIndexOf("|")
  if (sep === -1) return null
  const email = payload.slice(0, sep)
  const expiresAt = Number(payload.slice(sep + 1))
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null
  return { email, expiresAt }
}

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "Lax" as const,
  path: "/admin",
  maxAge: Math.floor(SESSION_TTL_MS / 1000),
}
