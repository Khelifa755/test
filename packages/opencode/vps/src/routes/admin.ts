import { Hono } from "hono"
import { setCookie, getCookie, deleteCookie } from "hono/cookie"
import { sql } from "@/lib/db"
import { verifyPassword } from "@/lib/password"
import { env } from "@/lib/env"
import {
  ADMIN_SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  issueSession,
  verifySession,
} from "@/lib/admin-session"

export const admin = new Hono()

const escape = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")

const requireAdminSession = (c: { req: { header: (name: string) => string | undefined } }) =>
  verifySession(c.req.header("Cookie")?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ADMIN_SESSION_COOKIE}=`))
    ?.slice(ADMIN_SESSION_COOKIE.length + 1))

type FormBody = Record<string, string | File>

const readField = (body: FormBody | undefined, key: string): string => {
  if (!body) return ""
  const value = body[key]
  return typeof value === "string" ? value : ""
}

const loginFormHtml = (error: boolean) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>kilo admin</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0c0a09;color:#fafaf9;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}
form{background:#1c1917;padding:32px;border-radius:8px;border:1px solid #292524;min-width:320px}
h1{font-size:18px;margin:0 0 16px}
label{display:block;margin:12px 0 4px;font-size:13px;color:#a6a09b}
input{width:100%;box-sizing:border-box;background:#0c0a09;border:1px solid #44403b;color:#fafaf9;padding:8px;border-radius:4px}
button{margin-top:16px;width:100%;background:#f9f76f;color:#0c0a09;border:0;padding:10px;border-radius:4px;font-weight:600;cursor:pointer}
.err{color:#ff6467;font-size:13px;margin-bottom:8px}</style>
</head><body>
<form method="POST" action="/admin/login">
<h1>kilo admin</h1>
${error ? '<div class="err">invalid credentials</div>' : ""}
<label>email<input type="email" name="email" required autofocus></label>
<label>password<input type="password" name="password" required></label>
<button type="submit">sign in</button>
</form></body></html>`

const dashboardHtml = async () => {
  let users: Array<{
    id: string
    email: string
    tier: "free" | "paid"
    grace_until: Date | null
    today_count: number | null
    last_device_seen: Date | null
  }> = []
  let dashboardError: string | null = null
  try {
    const rows = await sql`
      SELECT u.id, u.email, u.tier, u.grace_until,
        COALESCE(ud.count, 0) AS today_count,
        (SELECT MAX(d.last_seen) FROM devices d WHERE d.user_id = u.id) AS last_device_seen
      FROM users u
      LEFT JOIN usage_daily ud
        ON ud.user_id = u.id AND ud.date = CURRENT_DATE
      ORDER BY u.created_at DESC
    `
    users = rows as unknown as typeof users
  } catch (cause) {
    dashboardError = cause instanceof Error ? cause.message : String(cause)
  }
  const rows = users
    .map(
      (u) => `<tr>
<td><code>${escape(u.email)}</code></td>
<td>${escape(u.tier)}</td>
<td>${u.grace_until ? escape(u.grace_until.toISOString()) : "—"}</td>
<td>${escape((u.today_count ?? 0).toString())}</td>
<td>${u.last_device_seen ? escape(u.last_device_seen.toISOString()) : "—"}</td>
<td style="white-space:nowrap">
<form method="POST" action="/admin/grant" style="display:inline">
<input type="hidden" name="email" value="${escape(u.email)}">
<input type="hidden" name="days" value="30">
<button type="submit">grant 30d</button>
</form>
<form method="POST" action="/admin/revoke" style="display:inline" onsubmit="return confirm('revoke ${escape(u.email)}?')">
<input type="hidden" name="user_id" value="${escape(u.id)}">
<button type="submit">revoke</button>
</form>
</td>
</tr>`,
    )
    .join("\n")

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>kilo admin · dashboard</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0c0a09;color:#fafaf9;margin:0;padding:24px}
header{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}
h1{font-size:20px;margin:0;color:#f9f76f}
form{display:inline}
button{background:#f9f76f;color:#0c0a09;border:0;padding:6px 12px;border-radius:4px;font-weight:600;cursor:pointer;margin-left:4px}
button.danger{background:#ff6467;color:#0c0a09}
.logout{background:#44403b;color:#fafaf9}
table{width:100%;border-collapse:collapse;background:#1c1917;border:1px solid #292524;border-radius:6px;overflow:hidden}
th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #292524;font-size:13px}
th{background:#292524;color:#f9f76f;font-weight:600}
tr:last-child td{border-bottom:0}
code{font-family:Menlo,Monaco,Consolas,monospace;font-size:12px;color:#a6a09b}
small{color:#79716b;font-size:11px}
form.danger button{background:#ff6467}
</style></head><body>
<header>
<h1>kilo admin</h1>
<form method="POST" action="/admin/logout">
<button type="submit" class="logout">logout</button>
</form>
</header>
${dashboardError ? `<pre style="background:#3a1515;color:#ff6467;padding:12px;border-radius:6px;font-size:12px;overflow:auto;margin-bottom:16px">${escape(dashboardError)}</pre>` : ""}
<small>${escape(users.length)} users</small>
<table>
<thead><tr>
<th>email</th><th>tier</th><th>grace_until</th><th>today</th><th>last seen</th><th>actions</th>
</tr></thead>
<tbody>${rows || '<tr><td colspan="6" style="text-align:center;padding:32px;color:#79716b">no users yet</td></tr>'}</tbody>
</table>
</body></html>`
}

admin.get("/", async (c) => {
  const session = requireAdminSession(c)
  if (!session) {
    const hasError = c.req.query("error") === "1"
    return c.html(loginFormHtml(hasError))
  }
  const html = await dashboardHtml()
  return c.html(html)
})

admin.post("/login", async (c) => {
  const body = (await c.req.parseBody().catch(() => ({}))) as FormBody
  const email = readField(body, "email")
  const password = readField(body, "password")
  if (email !== env.ADMIN_EMAIL) {
    return c.redirect("/admin?error=1", 303)
  }
  const ok = await verifyPassword(password, env.ADMIN_PASSWORD_HASH)
  if (!ok) {
    return c.redirect("/admin?error=1", 303)
  }
  const { token, maxAgeSec } = issueSession(email)
  setCookie(c, ADMIN_SESSION_COOKIE, token, {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: maxAgeSec,
  })
  return c.redirect("/admin", 303)
})

admin.post("/grant", async (c) => {
  const session = requireAdminSession(c)
  if (!session) return c.redirect("/admin", 303)
  const body = (await c.req.parseBody().catch(() => ({}))) as FormBody
  const email = readField(body, "email")
  const rawDays = readField(body, "days")
  const days = Number.isFinite(Number.parseInt(rawDays, 10)) && Number(rawDays) > 0
    ? Number(rawDays)
    : 30
  if (!email) return c.redirect("/admin", 303)
  await sql`
    UPDATE users SET tier = 'paid', grace_until = now() + (${days}::int * interval '1 day')
    WHERE email = ${email}
  `
  await sql`
    INSERT INTO admin_grants (user_email, granted_days) VALUES (${email}, ${days})
  `
  return c.redirect("/admin", 303)
})

admin.post("/revoke", async (c) => {
  const session = requireAdminSession(c)
  if (!session) return c.redirect("/admin", 303)
  const body = (await c.req.parseBody().catch(() => ({}))) as FormBody
  const user_id = readField(body, "user_id")
  if (!user_id) return c.redirect("/admin", 303)
  await sql`
    INSERT INTO revocations (user_id, reason) VALUES (${user_id}, 'admin_revoke')
  `
  return c.redirect("/admin", 303)
})

admin.post("/logout", async (c) => {
  deleteCookie(c, ADMIN_SESSION_COOKIE, { path: "/admin" })
  return c.redirect("/admin", 303)
})
