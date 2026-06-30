import { z } from "zod"

const bcryptHash = z
  .string()
  .min(1, "must not be empty (escape $ as \\$ in .env)")
  .refine((v) => /^\$2[aby]\$\d{2}\$/.test(v), "must look like a bcrypt hash ($2a$12$…)")

const pemBlock = z
  .string()
  .min(64, "PEM is too short — Bun likely expanded $ vars; escape them as \\$")
  .refine((v) => v.includes("BEGIN "), "must include a PEM header")

const schema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_PRIVATE_KEY_PEM: pemBlock,
  JWT_PUBLIC_KEY_PEM: pemBlock,
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
  PORT: z.coerce.number().int().positive().default(8787),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD_HASH: bcryptHash,
  ADMIN_SESSION_SECRET: z.string().min(32),
})

export const env = schema.parse(process.env)
