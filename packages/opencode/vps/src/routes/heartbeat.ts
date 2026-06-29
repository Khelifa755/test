import { Hono } from "hono"
import { z } from "zod"
import { sql } from "@/lib/db"
import { requireAuth } from "@/middleware/auth"

const FREE_TIER_DAILY_LIMIT = 10

const heartbeatSchema = z.object({
  device_id: z.string().min(1).max(128),
})

export const heartbeat = new Hono()

heartbeat.post("/", requireAuth(), async (c) => {
  const user = c.var.user
  const body = await c.req.json().catch(() => null)
  const parsed = heartbeatSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: "invalid payload", details: parsed.error.flatten() }, 400)
  }
  const { device_id } = parsed.data

  const deviceRows = await sql`
    SELECT id FROM devices
    WHERE user_id = ${user.sub}
      AND device_id = ${device_id}
      AND revoked = false
  `
  if (deviceRows.length === 0) {
    return c.json({ allowed: false, reason: "device_revoked" }, 401)
  }

  await sql`
    UPDATE devices SET last_seen = now()
    WHERE user_id = ${user.sub} AND device_id = ${device_id}
  `

  const revocations = await sql`
    SELECT id FROM revocations WHERE user_id = ${user.sub} LIMIT 1
  `
  if (revocations.length > 0) {
    return c.json({ allowed: false, reason: "account_suspended" }, 200)
  }

  const userRows = await sql`
    SELECT tier, grace_until FROM users WHERE id = ${user.sub}
  `
  if (userRows.length === 0) {
    return c.json({ allowed: false, reason: "user_not_found" }, 401)
  }
  let { tier, grace_until } = userRows[0] as {
    tier: "free" | "paid"
    grace_until: Date | null
  }

  if (tier === "paid" && grace_until !== null && grace_until < new Date()) {
    await sql`UPDATE users SET tier = 'free' WHERE id = ${user.sub}`
    tier = "free"
  }

  if (tier === "free") {
    const usage = await sql`
      SELECT count FROM usage_daily
      WHERE user_id = ${user.sub} AND date = CURRENT_DATE
    `
    const count = usage.length > 0 ? (usage[0].count as number) : 0
    if (count >= FREE_TIER_DAILY_LIMIT) {
      return c.json({ allowed: false, reason: "quota_exceeded", remaining: 0 }, 200)
    }
    const updated = await sql`
      INSERT INTO usage_daily (user_id, date, count) VALUES (${user.sub}, CURRENT_DATE, 1)
      ON CONFLICT (user_id, date) DO UPDATE SET count = usage_daily.count + 1
      RETURNING count
    `
    const new_count = updated[0].count as number
    return c.json({ allowed: true, tier: "free", remaining: FREE_TIER_DAILY_LIMIT - new_count }, 200)
  }

  return c.json({ allowed: true, tier: "paid", remaining: -1 }, 200)
})
