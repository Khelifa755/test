import type { MiddlewareHandler } from "hono"

type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()
const WINDOW_MS = 60_000

export const rateLimit = (limit: number, keyPrefix: string): MiddlewareHandler => async (c, next) => {
  const ip =
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  const key = `${keyPrefix}:${ip}`
  const now = Date.now()
  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return next()
  }
  if (bucket.count >= limit) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000)
    c.header("Retry-After", String(retryAfter))
    return c.json({ error: "too many requests" }, 429)
  }
  bucket.count++
  return next()
}
