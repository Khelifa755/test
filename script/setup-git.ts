#!/usr/bin/env bun
// kilocode_change - new file

/**
 * Configures repo-local git settings for all contributors.
 *
 * `merge.conflictStyle=zdiff3` makes conflict markers include the common
 * ancestor (|||||||) alongside ours/theirs. That base section is what
 * mergiraf's syntax-aware resolution feeds on during upstream opencode
 * merges (see script/upstream/merge.ts) and it makes manual resolution
 * dramatically easier than the default 2-way `merge` markers.
 *
 * Runs from `postinstall`. Safe to re-run — `git config` is idempotent.
 * Guarded so tarball / docker installs without a `.git` don't fail.
 */

import { $ } from "bun"

const inside = await $`git rev-parse --is-inside-work-tree`.nothrow().quiet()
if (inside.exitCode !== 0) process.exit(0)

// `zdiff3` requires Git 2.35+ (released Jan 2022). Older Git refuses the
// value on every command and breaks `git switch`, `git checkout`, etc.
// Probe first, fall back to the default `merge` style on legacy installs.
const ver = (await $`git --version`.quiet().text()).trim()
const m = ver.match(/(\d+)\.(\d+)/)
const major = m ? Number(m[1]) : 0
const minor = m ? Number(m[2]) : 0
if (major > 2 || (major === 2 && minor >= 35)) {
  await $`git config --local merge.conflictStyle zdiff3`.quiet()
}
