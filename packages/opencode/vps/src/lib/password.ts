import bcrypt from "bcryptjs"
import { env } from "./env"

const cost = env.BCRYPT_COST

export const hashPassword = (password: string) => bcrypt.hash(password, cost)

export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash)
