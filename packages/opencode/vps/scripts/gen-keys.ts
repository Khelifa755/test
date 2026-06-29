const enc = new TextEncoder()
const dec = new TextDecoder()

const toB64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let bin = ""
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

const wrapPem = (b64: string, label: string) => {
  const lines = b64.match(/.{1,64}/g)?.join("\n") ?? b64
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`
}

const exportPem = async (
  key: CryptoKey,
  format: "pkcs8" | "spki",
  label: "PRIVATE KEY" | "PUBLIC KEY",
) => {
  const raw = await crypto.subtle.exportKey(format, key)
  const b64 = toB64(raw)
  return wrapPem(b64, label)
}

const pair = await crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"],
)

const privatePem = await exportPem(pair.privateKey, "pkcs8", "PRIVATE KEY")
const publicPem = await exportPem(pair.publicKey, "spki", "PUBLIC KEY")

console.log(`JWT_PRIVATE_KEY_PEM="${privatePem.replace(/\n/g, "\\n")}"`)
console.log(`JWT_PUBLIC_KEY_PEM="${publicPem.replace(/\n/g, "\\n")}"`)

void enc
void dec
