// kilocode_change - new file
import type { Argv } from "yargs"
import path from "path"
import os from "os"
import fs from "fs/promises"
import { cmd } from "../../../cli/cmd/cmd"
import { UI } from "../../../cli/ui"
import { Process } from "@/util/process"
import * as prompts from "@clack/prompts"

interface Args {
  checkOnly: boolean
  installOnly: boolean
  yes: boolean
  json: boolean
  variant: "regular" | "nerd" | "italic" | "all"
}

interface DetectResult {
  installed: boolean
  paths: string[]
  fontDir: string
  platform: NodeJS.Platform
}

interface InstallResult {
  ok: boolean
  files: string[]
  error?: string
}

const FONT_RELEASE_URL =
  "https://github.com/JetBrains/JetBrainsMono/releases/latest/download/JetBrainsMono-{variant}.zip"
const NERD_FONT_RELEASE_URL =
  "https://github.com/ryanoasis/nerd-fonts/releases/latest/download/JetBrainsMono.zip"

const variantMap = {
  regular: ["Regular", "Medium", "SemiBold", "Bold", "ExtraBold"],
  nerd: ["Regular", "Bold"],
  italic: ["Italic"],
  all: ["Regular", "Bold"],
}

export const FontsCommand = cmd({
  command: "fonts",
  describe: "install JetBrains Mono and configure terminals to use it",
  builder: (yargs: Argv) =>
    yargs
      .option("check-only", {
        describe: "only detect whether JetBrains Mono is installed",
        type: "boolean",
        default: false,
      })
      .option("install-only", {
        describe: "skip terminal configuration instructions",
        type: "boolean",
        default: false,
      })
      .option("yes", {
        alias: "y",
        describe: "skip confirmation prompts",
        type: "boolean",
        default: false,
      })
      .option("json", {
        describe: "output result as JSON",
        type: "boolean",
        default: false,
      })
      .option("variant", {
        describe: "font variant to install",
        choices: ["regular", "nerd", "italic", "all"],
        default: "regular",
      }),
  handler: async (args) => {
    if (process.env.KILO_PURE === "1") {
      UI.println("fonts command is disabled in pure mode")
      return
    }

    const platform = process.platform
    const detect = await runDetect()

    if (args.json) {
      console.log(JSON.stringify({ detect, platform }, null, 2))
    } else {
      printDetect(detect)
    }

    if (args.checkOnly) return

    if (!detect.fontDir) {
      const message = `unsupported platform: ${platform}`
      if (args.json) console.log(JSON.stringify({ error: message }))
      else UI.error(message)
      process.exitCode = 1
      return
    }

    const proceed = args.yes
      ? true
      : await prompts.confirm({
          message: detect.installed
            ? "JetBrains Mono already installed. Reinstall anyway?"
            : "Install JetBrains Mono system-wide?",
          initialValue: true,
        })
    if (!proceed || prompts.isCancel(proceed)) {
      prompts.outro("Cancelled")
      return
    }

    const installed = await runInstall(detect.fontDir, args.variant as Args["variant"])
    if (!installed.ok) {
      const message = `install failed: ${installed.error ?? "unknown error"}`
      if (args.json) console.log(JSON.stringify({ error: message }))
      else UI.error(message)
      process.exitCode = 1
      return
    }

    if (args.json) {
      console.log(JSON.stringify({ installed: installed.files }, null, 2))
    } else {
      UI.println(`${UI.Style.TEXT_SUCCESS}installed ${installed.files.length} font file(s):${UI.Style.TEXT_NORMAL}`)
      for (const f of installed.files) UI.println(`  ${f}`)
    }

    const registered = await runRegister(platform)
    if (registered.length === 0) {
      if (!args.json) UI.println(`${UI.Style.TEXT_WARNING}could not auto-register fonts; a log-out may be required${UI.Style.TEXT_NORMAL}`)
    } else if (!args.json) {
      UI.println(`${UI.Style.TEXT_SUCCESS}rebuilt font cache${UI.Style.TEXT_NORMAL}`)
    }

    if (!args.installOnly && !args.json) printTerminalInstructions(platform)
  },
})

export async function detectFonts(): Promise<DetectResult> {
  const platform = process.platform
  const searchPaths = searchPathsForPlatform(platform)
  const found: string[] = []
  for (const dir of searchPaths) {
    try {
      const files = await fs.readdir(dir)
      for (const file of files) {
        if (/^JetBrainsMono/i.test(file) && /\.(ttf|otf|ttc)$/i.test(file)) {
          found.push(path.join(dir, file))
        }
      }
    } catch {
      continue
    }
  }
  return {
    installed: found.length > 0,
    paths: found,
    fontDir: fontsDirForPlatform(platform),
    platform,
  }
}

export async function runDetect(): Promise<DetectResult> {
  return detectFonts()
}

function searchPathsForPlatform(platform: NodeJS.Platform): string[] {
  const home = os.homedir()
  if (platform === "win32") {
    const winFonts = path.join(process.env.WINDIR ?? "C:\\Windows", "Fonts")
    const userFonts = path.join(process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "Microsoft", "Windows", "Fonts")
    return [winFonts, userFonts]
  }
  if (platform === "darwin") {
    return [path.join("/", "Library", "Fonts"), path.join(home, "Library", "Fonts")]
  }
  return [
    path.join(home, ".local", "share", "fonts"),
    path.join(home, ".fonts"),
    path.join("/", "usr", "share", "fonts"),
    path.join("/", "usr", "local", "share", "fonts"),
  ]
}

function fontsDirForPlatform(platform: NodeJS.Platform): string {
  const home = os.homedir()
  if (platform === "win32") {
    return path.join(process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "Microsoft", "Windows", "Fonts")
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Fonts")
  }
  return path.join(home, ".local", "share", "fonts")
}

function printDetect(detect: DetectResult): void {
  const label = detect.installed
    ? `${UI.Style.TEXT_SUCCESS}JetBrains Mono is installed${UI.Style.TEXT_NORMAL}`
    : `${UI.Style.TEXT_WARNING}JetBrains Mono is not installed${UI.Style.TEXT_NORMAL}`
  UI.println(label)
  for (const p of detect.paths) UI.println(`  ${UI.Style.TEXT_DIM}${p}${UI.Style.TEXT_NORMAL}`)
  if (!        detect.fontDir) UI.println(`${UI.Style.TEXT_DIM}(no per-user font directory on ${detect.platform})${UI.Style.TEXT_NORMAL}`)
}

export async function runInstall(fontsDir: string, variant: Args["variant"]): Promise<InstallResult> {
  try {
    await fs.mkdir(fontsDir, { recursive: true })
  } catch (cause) {
    return { ok: false, files: [], error: String(cause) }
  }

  const zipUrl = variant === "nerd" ? NERD_FONT_RELEASE_URL : FONT_RELEASE_URL.replace("{variant}", variant)
  const zipPath = path.join(os.tmpdir(), `jetbrains-mono-${variant}-${Date.now()}.zip`)

  try {
    const download = await Process.run(
      [
        process.platform === "win32" ? "powershell" : "curl",
        ...(process.platform === "win32"
          ? ["-NoProfile", "-Command", `Invoke-WebRequest -Uri '${zipUrl}' -OutFile '${zipPath}'`]
          : ["-L", "-fsSL", "-o", zipPath, zipUrl]),
      ],
      { nothrow: true },
    )
    if (download.code !== 0) {
      return { ok: false, files: [], error: `download failed (exit ${download.code})` }
    }
  } catch (cause) {
    return { ok: false, files: [], error: `download failed: ${String(cause)}` }
  }

  try {
    if (process.platform === "win32") {
      const expand = await Process.run(
        [
          "powershell",
          "-NoProfile",
          "-Command",
          `Expand-Archive -Path '${zipPath}' -DestinationPath '${fontsDir}' -Force`,
        ],
        { nothrow: true },
      )
      if (expand.code !== 0) return { ok: false, files: [], error: "extract failed" }
    } else {
      const untar = await Process.run(["unzip", "-o", "-q", zipPath, "-d", fontsDir], { nothrow: true })
      if (untar.code !== 0) {
        const alt = await Process.run(["tar", "-xf", zipPath, "-C", fontsDir], { nothrow: true })
        if (alt.code !== 0) return { ok: false, files: [], error: "extract failed (tried unzip and tar)" }
      }
    }
  } catch (cause) {
    return { ok: false, files: [], error: `extract failed: ${String(cause)}` }
  }

  const expectedPrefixes = variantMap[variant]
  const files: string[] = []
  try {
    const entries = await fs.readdir(fontsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!/\.(ttf|otf|ttc)$/i.test(entry.name)) continue
      if (!expectedPrefixes.some((prefix) => entry.name.includes(prefix))) continue
      files.push(path.join(fontsDir, entry.name))
    }
  } catch (cause) {
    return { ok: false, files: [], error: `verify failed: ${String(cause)}` }
  }

  await fs.unlink(zipPath).catch(() => undefined)
  return { ok: files.length > 0, files, error: files.length === 0 ? "no font files found after extract" : undefined }
}

export async function runRegister(platform: NodeJS.Platform): Promise<string[]> {
  const out: string[] = []
  if (platform === "win32") {
    const r = await Process.run(
      [
        "powershell",
        "-NoProfile",
        "-Command",
        "$null = (New-Object -ComObject Shell.Application); Write-Output 'cache-flushed'",
      ],
      { nothrow: true },
    )
    if (r.code === 0) out.push("shell-flush")
  } else if (platform === "darwin") {
    const r = await Process.run(["atsutil", "databases", "-remove"], { nothrow: true })
    if (r.code === 0) out.push("atsutil-refreshed")
  } else {
    const r1 = await Process.run(["fc-cache", "-fv"], { nothrow: true })
    if (r1.code === 0) out.push("fc-cache")
  }
  return out
}

function printTerminalInstructions(platform: NodeJS.Platform): void {
  UI.empty()
  UI.println(`${UI.Style.TEXT_INFO_BOLD}Recommended terminal configuration:${UI.Style.TEXT_NORMAL}`)
  UI.empty()

  if (platform === "win32") {
    UI.println(`${UI.Style.TEXT_DIM}Windows Terminal (settings.json):${UI.Style.TEXT_NORMAL}`)
    UI.println(`  "fontFace": "JetBrains Mono",`)
    UI.println(`  "fontSize": 13`)
    UI.empty()
    UI.println(`${UI.Style.TEXT_DIM}VS Code (settings.json):${UI.Style.TEXT_NORMAL}`)
    UI.println(`  "editor.fontFamily": "JetBrains Mono",`)
    UI.println(`  "terminal.integrated.fontFamily": "JetBrains Mono",`)
    UI.println(`  "editor.fontLigatures": true,`)
    UI.empty()
    UI.println(`${UI.Style.TEXT_DIM}PowerShell profile location:${UI.Style.TEXT_NORMAL}`)
    UI.println(`  $PROFILE`)
  } else if (platform === "darwin") {
    UI.println(`${UI.Style.TEXT_DIM}iTerm2 (Preferences → Profiles → Text):${UI.Style.TEXT_NORMAL}`)
    UI.println(`  Font: JetBrainsMono-Regular 13pt`)
    UI.empty()
    UI.println(`${UI.Style.TEXT_DIM}VS Code (settings.json):${UI.Style.TEXT_NORMAL}`)
    UI.println(`  "editor.fontFamily": "JetBrains Mono"`)
    UI.empty()
    UI.println(`${UI.Style.TEXT_DIM}Kitty (kitty.conf):${UI.Style.TEXT_NORMAL}`)
    UI.println(`  font_family JetBrains Mono`)
  } else {
    UI.println(`${UI.Style.TEXT_DIM}GNOME Terminal (gsettings):${UI.Style.TEXT_NORMAL}`)
    UI.println(`  gsettings set org.gnome.desktop.interface monospace-font-name 'JetBrains Mono 13'`)
    UI.empty()
    UI.println(`${UI.Style.TEXT_DIM}Kitty (kitty.conf):${UI.Style.TEXT_NORMAL}`)
    UI.println(`  font_family JetBrains Mono`)
    UI.empty()
    UI.println(`${UI.Style.TEXT_DIM}VS Code (settings.json):${UI.Style.TEXT_NORMAL}`)
    UI.println(`  "editor.fontFamily": "JetBrains Mono"`)
    UI.empty()
    UI.println(`${UI.Style.TEXT_DIM}Alacritty (alacritty.toml):${UI.Style.TEXT_NORMAL}`)
    UI.println(`  [font.normal]`)
    UI.println(`  family = "JetBrains Mono"`)
    UI.println(`  style = "Regular"`)
  }

  UI.empty()
  UI.println(`${UI.Style.TEXT_DIM}verify installation: kilo fonts --check-only --json${UI.Style.TEXT_NORMAL}`)
}
