import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import os from "os"
import { tmpdir } from "../../fixture/fixture"
import { detectFonts } from "../../../src/kilocode/cli/cmd/fonts"

describe("fonts command detection", () => {
  test("reports installed when JetBrainsMono files exist in a search path", async () => {
    if (process.platform === "win32") {
      const fontsDir = path.join(os.homedir(), "AppData", "Local", "Microsoft", "Windows", "Fonts")
      await fs.mkdir(fontsDir, { recursive: true })
      const file = path.join(fontsDir, `JetBrainsMono-Test-${Date.now()}.ttf`)
      await fs.writeFile(file, "")
      try {
        const result = await detectFonts()
        expect(result.platform).toBe("win32")
        expect(result.installed).toBe(true)
        expect(result.paths.some((p) => p.startsWith(fontsDir))).toBe(true)
      } finally {
        await fs.unlink(file).catch(() => undefined)
      }
      return
    }
    await using tmp = await tmpdir({
      init: async (dir) => {
        const fontsDir = path.join(dir, "fonts")
        await fs.mkdir(fontsDir, { recursive: true })
        await fs.writeFile(path.join(fontsDir, "JetBrainsMono-Regular.ttf"), "")
        return fontsDir
      },
    })
    const home = process.env.HOME
    const xdg = process.env.XDG_DATA_HOME
    process.env.HOME = tmp.path
    process.env.XDG_DATA_HOME = path.join(tmp.path, "data")
    await fs.mkdir(path.join(tmp.path, "data"), { recursive: true })
    await fs.symlink(tmp.extra, path.join(tmp.path, "data", "fonts"))
    try {
      const result = await detectFonts()
      expect(result.platform).toBe(process.platform)
      expect(result.installed).toBe(true)
      expect(result.paths.some((p) => p.startsWith(tmp.extra))).toBe(true)
    } finally {
      if (home === undefined) delete process.env.HOME
      else process.env.HOME = home
      if (xdg === undefined) delete process.env.XDG_DATA_HOME
      else process.env.XDG_DATA_HOME = xdg
    }
  })

  test("returns not-installed when no JetBrainsMono files are present", async () => {
    await using tmp = await tmpdir()
    const home = process.env.HOME
    const xdg = process.env.XDG_DATA_HOME
    process.env.HOME = tmp.path
    process.env.XDG_DATA_HOME = path.join(tmp.path, "data")
    await fs.mkdir(path.join(tmp.path, "data"), { recursive: true })
    try {
      const result = await detectFonts()
      expect(result.installed).toBe(false)
      expect(result.paths.length).toBe(0)
    } finally {
      if (home === undefined) delete process.env.HOME
      else process.env.HOME = home
      if (xdg === undefined) delete process.env.XDG_DATA_HOME
      else process.env.XDG_DATA_HOME = xdg
    }
  })
})
