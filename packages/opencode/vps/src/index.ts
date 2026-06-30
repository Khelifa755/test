import app from "./server"
import { env } from "./lib/env"
import type { Serve } from "bun"

export default {
  port: env.PORT,
  fetch: app.fetch,
} satisfies Serve.Options<undefined>

console.log(`kilo-vps listening on :${env.PORT}`)