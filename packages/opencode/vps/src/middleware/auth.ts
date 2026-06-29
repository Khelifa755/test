import type { MiddlewareHandler } from "hono"
import { verifyJWT, type TokenPayload } from "@/lib/jwt"

declare module "hono" {
  interface ContextVariableMap {
    user: TokenPayload
  }
}

export const requireAuth = (): MiddlewareHandler => async (c, next) => {
  const header = c.req.header("Authorization")
  if (!header?.startsWith("Bearer ")) {
    return c.json({ error: "missing bearer token" }, 401)
  }
  const token = header.slice("Bearer ".length).trim()
  try {
    const payload = verifyJWT(token)
    c.set("user", payload)
    return next()
  } catch (err) {
    return c.json({ error: "invalid or expired token" }, 401)
  }
}
