import postgres from "postgres"
import { env } from "./env"

export const sql = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 30,
  prepare: false,
})

export type User = {
  id: string
  email: string
  password_hash: string
  tier: "free" | "paid"
  grace_until: Date | null
  created_at: Date
}

export type Device = {
  id: string
  user_id: string
  device_id: string
  label: string | null
  last_seen: Date
  revoked: boolean
}

export type RefreshToken = {
  id: string
  user_id: string
  token_hash: string
  family: string
  revoked: boolean
  created_at: Date
}
