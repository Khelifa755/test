import bcrypt from "bcryptjs"

const password = process.argv[2]

if (!password) {
  console.error("usage: bun run scripts/hash-password.ts <password>")
  process.exit(1)
}

const hash = await bcrypt.hash(password, 12)
console.log(`ADMIN_PASSWORD_HASH='${hash}'`)
