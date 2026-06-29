import { Hono } from "hono"
import { cors } from "hono/cors"
import { runMigrations } from "./db"

const port = Number(process.env.KILO_VPS_PORT ?? 3000)
const limit = 60
const windowMs = 60_000
const hits = new Map<string, { count: number; reset: number }>()

const app = new Hono()

app.use("*", cors())

app.use("*", async (c, next) => {
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "unknown"
  const now = Date.now()
  const entry = hits.get(ip) ?? { count: 0, reset: now + windowMs }

  if (now > entry.reset) {
    entry.count = 0
    entry.reset = now + windowMs
  }

  entry.count++
  hits.set(ip, entry)

  if (entry.count > limit) return c.text("Too Many Requests", 429)
  await next()
})

app.use("*", async (c, next) => {
  const start = Date.now()
  await next()
  const ms = Date.now() - start
  console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${ms}ms`)
})

app.get("/health", (c) => c.json({ status: "ok", ts: Date.now() }))

app.route("/v1", new Hono())
app.route("/admin", new Hono())

await runMigrations()

Bun.serve({
  port,
  fetch: app.fetch,
})

console.log(`kilo-vps listening on http://localhost:${port}`)
