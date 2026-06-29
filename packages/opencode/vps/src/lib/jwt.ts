import jwt from "jsonwebtoken"
import { env } from "./env"

const privateKey = env.JWT_PRIVATE_KEY_PEM
const publicKey = env.JWT_PUBLIC_KEY_PEM

export type TokenPayload = {
  sub: string
  tier: "free" | "paid"
  device_id: string
  iat?: number
  exp?: number
}

export const signAccessToken = (payload: Omit<TokenPayload, "iat" | "exp">): string => {
  const options: jwt.SignOptions = {
    algorithm: "RS256",
    expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions["expiresIn"],
  }
  return jwt.sign(payload, privateKey, options)
}

export const verifyJWT = (token: string): TokenPayload => {
  const decoded = jwt.verify(token, publicKey, { algorithms: ["RS256"] })
  if (typeof decoded === "string" || decoded === null) {
    throw new Error("invalid token payload")
  }
  const payload = decoded as TokenPayload
  if (!payload.sub || !payload.tier || !payload.device_id) {
    throw new Error("missing required claims")
  }
  return payload
}
