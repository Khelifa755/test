import { z } from "zod"

const schema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_PRIVATE_KEY_PEM: z.string().min(1),
  JWT_PUBLIC_KEY_PEM: z.string().min(1),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
  PORT: z.coerce.number().int().positive().default(8787),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD_HASH: z.string().min(1),
  ADMIN_SESSION_SECRET: z.string().min(32),
})

export const env = schema.parse(process.env)
