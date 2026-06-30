import app from "./server"
import { env } from "./lib/env"
import { runMigrations } from "./lib/migrate"
import type { Serve } from "bun"

await runMigrations()

export default {
  port: env.PORT,
  fetch: app.fetch,
} satisfies Serve.Options<undefined>

console.log(`kilo-vps listening on :${env.PORT}`)