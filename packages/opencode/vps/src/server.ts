import { Hono } from "hono"
import { auth } from "./routes/auth"
import { heartbeat } from "./routes/heartbeat"
import { admin } from "./routes/admin"

const app = new Hono()

app.get("/healthz", (c) => c.json({ ok: true }))

const v1 = new Hono()
v1.route("/auth", auth)
v1.route("/heartbeat", heartbeat)

app.route("/v1", v1)
app.route("/admin", admin)

export default app
