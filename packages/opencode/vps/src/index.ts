import app from "./server"
import { env } from "./lib/env"
import { runMigrations } from "./lib/migrate"
import type { Serve } from "bun"

try {
  const { applied } = await runMigrations()
  if (applied.length === 0) {
    console.log("[migrate] no pending migrations")
  } else {
    console.log(`[migrate] applied ${applied.length} migration(s): ${applied.join(", ")}`)
  }
} catch (err) {
  console.error("[migrate] FAILED:", err instanceof Error ? err.stack ?? err.message : err)
  process.exit(1)
}

export default {
  port: env.PORT,
  fetch: app.fetch,
} satisfies Serve.Options<undefined>

console.log(`kilo-vps listening on :${env.PORT}`)