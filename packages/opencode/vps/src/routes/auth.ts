import { Hono } from "hono"
import { z } from "zod"
import { randomUUID, createHash } from "node:crypto"
import { sql } from "@/lib/db"
import { hashPassword, verifyPassword } from "@/lib/password"
import { signAccessToken, verifyJWT } from "@/lib/jwt"
import { requireAuth } from "@/middleware/auth"
import { rateLimit } from "@/middleware/rate-limit"

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(256),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  device_id: z.string().min(1).max(128),
  device_label: z.string().max(128).optional(),
})

const refreshSchema = z.object({
  refresh_token: z.string().min(1),
})

const logoutSchema = z.object({
  refresh_token: z.string().min(1),
})

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex")

export const auth = new Hono()

auth.post("/signup", async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = signupSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: "invalid payload", details: parsed.error.flatten() }, 400)
  }
  const { email, password } = parsed.data
  const existing = await sql`
    SELECT id FROM users WHERE email = ${email}
  `
  if (existing.length > 0) {
    return c.json({ error: "email already registered" }, 409)
  }
  const hash = await hashPassword(password)
  await sql`
    INSERT INTO users (email, password_hash) VALUES (${email}, ${hash})
  `
  return c.json({ message: "account created" }, 201)
})

auth.post("/login", rateLimit(5, "login"), async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = loginSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: "invalid payload", details: parsed.error.flatten() }, 400)
  }
  const { email, password, device_id, device_label } = parsed.data
  const rows = await sql`
    SELECT id, password_hash, tier FROM users WHERE email = ${email}
  `
  if (rows.length === 0) {
    return c.json({ error: "invalid credentials" }, 401)
  }
  const user = rows[0] as { id: string; password_hash: string; tier: "free" | "paid" }
  const ok = await verifyPassword(password, user.password_hash)
  if (!ok) {
    return c.json({ error: "invalid credentials" }, 401)
  }
  await sql`
    INSERT INTO devices (user_id, device_id, label, last_seen)
    VALUES (${user.id}, ${device_id}, ${device_label ?? null}, now())
    ON CONFLICT (user_id, device_id) DO UPDATE
      SET last_seen = now(),
          label = COALESCE(EXCLUDED.label, devices.label),
          revoked = false
  `
  const access_token = signAccessToken({
    sub: user.id,
    tier: user.tier,
    device_id,
  })
  const refresh_token = randomUUID()
  const token_hash = hashToken(refresh_token)
  const family = randomUUID()
  await sql`
    INSERT INTO refresh_tokens (user_id, token_hash, family)
    VALUES (${user.id}, ${token_hash}, ${family})
  `
  return c.json({ access_token, refresh_token })
})

auth.post("/refresh", async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = refreshSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: "invalid payload", details: parsed.error.flatten() }, 400)
  }
  const token_hash = hashToken(parsed.data.refresh_token)
  const rows = await sql`
    SELECT rt.id, rt.user_id, rt.family, rt.revoked, u.tier
    FROM refresh_tokens rt
    JOIN users u ON u.id = rt.user_id
    WHERE rt.token_hash = ${token_hash}
  `
  if (rows.length === 0) {
    return c.json({ error: "unknown refresh token" }, 401)
  }
  const row = rows[0] as {
    id: string
    user_id: string
    family: string
    revoked: boolean
    tier: "free" | "paid"
  }
  if (row.revoked) {
    await sql`
      UPDATE refresh_tokens SET revoked = true WHERE family = ${row.family}
    `
    return c.json({ error: "refresh token revoked" }, 401)
  }
  await sql`
    UPDATE refresh_tokens SET revoked = true WHERE id = ${row.id}
  `
  const deviceRow = await sql`
    SELECT device_id FROM devices WHERE user_id = ${row.user_id} ORDER BY last_seen DESC LIMIT 1
  `
  const device_id =
    deviceRow.length > 0 && deviceRow[0].device_id ? deviceRow[0].device_id : "unknown"
  const access_token = signAccessToken({
    sub: row.user_id,
    tier: row.tier,
    device_id,
  })
  const refresh_token = randomUUID()
  const new_token_hash = hashToken(refresh_token)
  await sql`
    INSERT INTO refresh_tokens (user_id, token_hash, family)
    VALUES (${row.user_id}, ${new_token_hash}, ${row.family})
  `
  return c.json({ access_token, refresh_token })
})

auth.post("/logout", requireAuth(), async (c) => {
  verifyJWT(c.req.header("Authorization")!.slice("Bearer ".length).trim())
  const body = await c.req.json().catch(() => null)
  const parsed = logoutSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: "invalid payload", details: parsed.error.flatten() }, 400)
  }
  const token_hash = hashToken(parsed.data.refresh_token)
  await sql`
    UPDATE refresh_tokens SET revoked = true WHERE token_hash = ${token_hash}
  `
  return c.json({ message: "logged out" })
})

export const __test = { hashToken, refreshSchema, loginSchema, signupSchema, logoutSchema }
