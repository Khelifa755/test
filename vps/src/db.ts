import { SQL } from "bun"
import fs from "fs/promises"
import path from "path"

const url = process.env.DATABASE_URL
if (!url) throw new Error("DATABASE_URL is required")

export const sql = new SQL(url)

const migrationsDir = path.join(import.meta.dir, "..", "migrations")

async function ensureMigrationsTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
}

async function appliedFiles() {
  const rows = await sql<{ filename: string }[]>`SELECT filename FROM schema_migrations ORDER BY filename`
  return new Set(rows.map((row) => row.filename))
}

async function listMigrationFiles() {
  let entries: string[]
  try {
    entries = await fs.readdir(migrationsDir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return []
    throw err
  }
  return entries.filter((name) => name.endsWith(".sql")).sort()
}

export async function runMigrations() {
  await ensureMigrationsTable()
  const done = await appliedFiles()
  const files = await listMigrationFiles()

  for (const file of files) {
    if (done.has(file)) continue
    const body = await fs.readFile(path.join(migrationsDir, file), "utf8")
    await sql.unsafe(body)
    await sql`INSERT INTO schema_migrations (filename) VALUES (${file})`
  }
}
