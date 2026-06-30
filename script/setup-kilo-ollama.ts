#!/usr/bin/env bun
// kilocode_change - new file

/**
 * Forces the local kilo CLI to use Ollama as its default provider.
 *
 * Background: this is a Kilo fork. The CLI auto-loads the bundled Kilo
 * Gateway provider and a `~/.local/share/kilo/config.json` and
 * `~/.config/kilo/kilo.jsonc` may exist on the developer's machine that
 * pin the default to the Kilo Gateway. Those per-machine files are NOT
 * tracked in git, so cloning the repo on another PC re-introduces the
 * gateway default.
 *
 * This script writes the per-machine config files so the local install
 * resolves `model: "ollama/minimax-m3:cloud"` and only the `ollama`
 * provider is enabled. It is safe to re-run — values are overwritten,
 * not merged, and the change is idempotent.
 *
 * Runs from `postinstall` and `bun run dev`.
 */

import { $ } from "bun"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { OLLAMA_DEFAULT_CONFIG } from "../packages/opencode/src/kilocode/ollama-defaults.ts"

async function writeIfWritable(file: string, body: string) {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, body, "utf8")
    console.log(`[setup-kilo-ollama] wrote ${file}`)
  } catch (err) {
    console.warn(`[setup-kilo-ollama] skipped ${file}:`, err instanceof Error ? err.message : err)
  }
}

const home = os.homedir()
const platform = os.platform()

const localShare =
  platform === "win32"
    ? (process.env["LOCALAPPDATA"] ?? path.join(home, "AppData", "Local"))
    : process.env["XDG_DATA_HOME"] ?? path.join(home, ".local", "share")

const configDir =
  platform === "win32"
    ? process.env["APPDATA"] ?? path.join(home, "AppData", "Roaming")
    : process.env["XDG_CONFIG_HOME"] ?? path.join(home, ".config")

const body = JSON.stringify(OLLAMA_DEFAULT_CONFIG, null, 2) + "\n"

await writeIfWritable(path.join(localShare, "kilo", "config.json"), body)
await writeIfWritable(path.join(configDir, "kilo", "kilo.jsonc"), body)

// Verify ollama is reachable so the user gets a clear failure if not.
const reach = await $`curl -fsS --max-time 2 http://127.0.0.1:11434/api/tags`.nothrow().quiet()
if (reach.exitCode !== 0) {
  console.warn(
    "[setup-kilo-ollama] Ollama is not reachable at http://127.0.0.1:11434.\n" +
      "Install it from https://ollama.com/download and run:\n" +
      "  ollama pull minimax-m3:cloud\n" +
      "  ollama pull gemma4:31b-cloud\n" +
      "  ollama serve",
  )
} else {
  console.log("[setup-kilo-ollama] Ollama is reachable.")
}
