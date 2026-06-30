import type { Argv } from "yargs"
import os from "os"
import { randomUUID, createHash } from "crypto"
import { execFile } from "child_process"
import { promisify } from "util"
import { readFile, writeFile, mkdir } from "fs/promises"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { cmd } from "../../../cli/cmd/cmd"
import * as prompts from "@clack/prompts"

const execFileAsync = promisify(execFile)
const STORE = path.join(Global.Path.data, "vps.json")

// Override via KILO_DEVICE_SALT to rotate without a code change. Bumping this invalidates
// every previously-issued device_id, which is a one-line "kick all devices" lever.
const DEFAULT_SALT = "kilo-vps-device-v1"
const SALT = process.env.KILO_DEVICE_SALT ?? DEFAULT_SALT

const WHITELIST = new Set([
  "login",
  "logout",
  "serve",
  "upgrade",
  "uninstall",
  "web",
  "admin",
  "stats",
])

export type VpsToken = { access_token: string; refresh_token: string }

export function isWhitelisted(argv: string[]): boolean {
  if (argv.includes("--help") || argv.includes("-h") || argv.includes("--version") || argv.includes("-v"))
    return true
  const cmd = argv.slice(2).find((a) => !a.startsWith("-"))
  return !cmd || WHITELIST.has(cmd)
}

export async function loadVpsStore(): Promise<VpsToken | null> {
  try {
    const data = JSON.parse(await readFile(STORE, "utf8"))
    if (data && typeof data.access_token === "string" && typeof data.refresh_token === "string") {
      return { access_token: data.access_token, refresh_token: data.refresh_token }
    }
  } catch {}
  return null
}

async function saveVpsStore(t: VpsToken): Promise<void> {
  await mkdir(Global.Path.data, { recursive: true })
  await writeFile(STORE, JSON.stringify(t, null, 2), { mode: 0o600 })
}

export const LoginCommand = cmd({
  command: "login",
  describe: "log in to your Kilo account",
  builder: (y: Argv) => y,
  handler: async () => {
    const url = process.env.KILO_VPS_URL ?? "http://192.168.253.153:8787" // prod swap: set KILO_VPS_URL to https://vps.<your-domain>
    const emailRaw = await prompts.text({ message: "Email" })
    const passwordRaw = await prompts.password({ message: "Password" })
    if (prompts.isCancel(emailRaw) || prompts.isCancel(passwordRaw)) {
      prompts.outro("Cancelled")
      return
    }
    const email = String(emailRaw)
    const password = String(passwordRaw)
    const { id: device_id } = await deviceId()
    const res = await fetch(`${url}/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, device_id, device_label: os.hostname() }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      prompts.log.error(`Login failed (${res.status}): ${body}`)
      process.exit(1)
    }
    const json = (await res.json()) as { access_token: string; refresh_token: string }
    await saveVpsStore({ access_token: json.access_token, refresh_token: json.refresh_token })
    prompts.log.success("Logged in.")
  },
})

export const LogoutCommand = cmd({
  command: "logout",
  describe: "log out of your Kilo account",
  builder: (y: Argv) => y,
  handler: async () => {
    try {
      await writeFile(STORE, "")
    } catch {}
    prompts.log.success("Logged out.")
  },
})

type HeartbeatResult = { kind: "allowed" } | { kind: "denied"; reason: string } | { kind: "offline" }

export async function callHeartbeat(input: {
  url: string
  token: string
  device_id: string
  command: string
  ts: number
}): Promise<HeartbeatResult> {
  const send = (token: string) =>
    fetch(`${input.url}/v1/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ device_id: input.device_id, command: input.command, ts: input.ts }),
    })
  const tryOnce = async (token: string): Promise<HeartbeatResult> => {
    try {
      const r = await send(token)
      if (r.status === 401) return { kind: "denied", reason: "unauthorized" }
      if (!r.ok) return { kind: "offline" }
      const j = (await r.json()) as { allowed: boolean; reason?: string }
      return j.allowed ? { kind: "allowed" } : { kind: "denied", reason: j.reason ?? "unknown" }
    } catch {
      return { kind: "offline" }
    }
  }

  let res = await tryOnce(input.token)
  if (res.kind === "denied" && res.reason === "unauthorized") {
    // token may just be expired — try refresh + heartbeat first
    const store = await loadVpsStore()
    if (store) {
      const rr = await fetch(`${input.url}/v1/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh_token: store.refresh_token }),
      })
      if (rr.ok) {
        const j = (await rr.json()) as { access_token: string; refresh_token: string }
        await saveVpsStore({ access_token: j.access_token, refresh_token: j.refresh_token })
        res = await tryOnce(j.access_token)
      }
    }
  }
  // Self-heal: the JWT was issued for an old device_id (e.g. user logged in before the CLI
  // started fingerprinting, or upgraded to a new machine). Register the new device_id on the
  // server and retry once. The server returns a fresh access_token bound to the new device_id.
  if (res.kind === "denied" && (res.reason === "device_revoked" || res.reason === "unauthorized")) {
    const store = await loadVpsStore()
    const reg = await fetch(`${input.url}/v1/auth/register-device`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${input.token}` },
      body: JSON.stringify({ device_id: input.device_id, device_label: os.hostname() }),
    }).catch(() => null)
    if (reg && reg.ok && store) {
      const j = (await reg.json()) as { access_token: string }
      await saveVpsStore({ access_token: j.access_token, refresh_token: store.refresh_token })
      res = await tryOnce(j.access_token)
    }
  }
  if (res.kind === "offline") {
    await new Promise((r) => setTimeout(r, 200 + Math.random() * 300))
    res = await tryOnce(input.token)
  }
  return res
}

export function denialMessage(reason: string): string {
  if (reason === "quota_exceeded") return "Free daily limit reached, upgrade to continue."
  if (reason === "account_suspended") return "Account suspended, contact support."
  if (reason === "device_revoked") return "This device has been revoked."
  if (reason === "user_not_found") return "Account not found. Please run `kilo login` again."
  return `Command blocked by VPS (${reason}).`
}

// Source of truth: hardware fingerprint, never the raw OS identifier, never a UUID from disk.
// The server's devices table is keyed on (user_id, device_id) and heartbeat rejects unknown
// device_ids, so deriving this from the machine itself makes token-file copying useless.
export async function deviceId(): Promise<{ id: string; bound: "hardware" | "fallback" }> {
  const raw = await readMachineId().catch(() => null)
  if (raw) return { id: sha256(SALT + "|" + raw), bound: "hardware" }
  process.stderr.write(
    "⚠ could not read a hardware machine id; falling back to a per-install random id. " +
      "Token file copying will not be detected on this machine.\n",
  )
  return { id: randomUUID(), bound: "fallback" }
}

async function readMachineId(): Promise<string | null> {
  if (process.platform === "linux") return readLinuxMachineId()
  if (process.platform === "darwin") return readMacMachineId()
  if (process.platform === "win32") return readWindowsMachineId()
  return null
}

async function readLinuxMachineId(): Promise<string | null> {
  // /etc/machine-id is the systemd-managed ID; /var/lib/dbus/machine-id is the older D-Bus copy.
  // Either is unique-per-install and stable across reboot. Container hosts may restrict reading
  // the former, in which case the latter or a host bind mount is the typical fallback.
  for (const p of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
    try {
      const v = (await readFile(p, "utf8")).trim()
      if (v) return `linux:${v}`
    } catch {}
  }
  return null
}

async function readMacMachineId(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"])
    const m = stdout.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)
    if (m) return `darwin:${m[1]}`
  } catch {}
  return null
}

async function readWindowsMachineId(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("reg", [
      "query",
      "HKLM\\SOFTWARE\\Microsoft\\Cryptography",
      "/v",
      "MachineGuid",
    ])
    const m = stdout.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/)
    if (m) return `win:${m[1]}`
  } catch {}
  return null
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex")
}
