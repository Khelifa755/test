import { Hono } from "hono"
import { auth } from "./routes/auth"
import { heartbeat } from "./routes/heartbeat"
import { admin } from "./routes/admin"

const app = new Hono()

app.get("/", (c) =>
  c.json({
    name: "kilo-vps",
    endpoints: ["/healthz", "/v1/auth", "/v1/heartbeat", "/admin"],
  }),
)

app.get("/healthz", (c) => c.json({ ok: true }))

app.onError((err, c) => {
  console.error("[vps] unhandled error", err)
  const detail =
    err instanceof Error ? err.stack ?? err.message : String(err)
  const accept = c.req.header("Accept") ?? ""
  if (accept.includes("text/html")) {
    return c.html(
      `<!doctype html><html><body style="background:#0c0a09;color:#ff6467;font-family:monospace;padding:24px">
       <h1>Internal Server Error</h1>
       <pre style="background:#1c1917;color:#fafaf9;padding:16px;border-radius:6px;overflow:auto">${detail.replace(/</g, "&lt;")}</pre>
       </body></html>`,
      500,
    )
  }
  return c.json(
    { error: "internal_server_error", message: err instanceof Error ? err.message : String(err) },
    500,
  )
})

app.notFound((c) => {
  if ((c.req.header("Accept") ?? "").includes("text/html")) {
    return c.html("<h1>404 not found</h1>", 404)
  }
  return c.json({ error: "not_found", path: c.req.path }, 404)
})

const v1 = new Hono()
v1.route("/auth", auth)
v1.route("/heartbeat", heartbeat)

app.route("/v1", v1)
app.route("/admin", admin)

export default app
