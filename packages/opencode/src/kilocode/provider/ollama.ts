// kilocode_change - new file

import * as Log from "@opencode-ai/core/util/log"
import { ModelID, ProviderID } from "@/provider/schema"
import { OLLAMA_DEFAULT_MODEL } from "@/kilocode/ollama-defaults"

const log = Log.create({ service: "ollama" })

const TagsItem = (raw: unknown) => {
  if (!raw || typeof raw !== "object") return undefined
  const name = "name" in raw && typeof raw.name === "string" ? raw.name : undefined
  return name ? { name } : undefined
}

export function ollamaBaseURL(raw: string | undefined, platform = process.platform) {
  if (raw?.trim()) return raw.trim()
  return platform === "win32" ? "http://127.0.0.1:11434/v1" : "http://localhost:11434/v1"
}

/** Native Ollama API root (no /v1 suffix). */
export function ollamaNativeURL(baseURL: string) {
  return baseURL.replace(/\/v1\/?$/, "").replace(/\/+$/, "")
}

function ollamaModel(name: string) {
  const id = name.replace(/:latest$/, "")
  return {
    id: ModelID.make(id),
    providerID: ProviderID.make("ollama"),
    name: id,
    family: "",
    api: {
      id,
      url: "",
      npm: "@ai-sdk/openai-compatible",
    },
    status: "active" as const,
    headers: {},
    options: {},
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 128000, output: 8192 },
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    release_date: "",
    variants: {},
  }
}

export async function discoverOllamaModels(baseURL: string, fallback: string[] = []) {
  const models: Record<string, ReturnType<typeof ollamaModel>> = {}
  const seed = (name: string) => {
    const id = name.replace(/:latest$/, "")
    if (!models[id]) models[id] = ollamaModel(id)
  }

  for (const name of fallback) seed(name)
  if (!fallback.length) seed(OLLAMA_DEFAULT_MODEL)

  const url = `${ollamaNativeURL(baseURL)}/api/tags`
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: "application/json" },
    })
    if (!res.ok) {
      log.warn("ollama model discovery failed", { url, status: res.status })
      return models
    }
    const json = (await res.json()) as { models?: unknown[] }
    for (const item of json.models ?? []) {
      const tag = TagsItem(item)
      if (tag) seed(tag.name)
    }
    log.info("ollama model discovery complete", { count: Object.keys(models).length })
  } catch (err) {
    log.warn("ollama model discovery unreachable", { url, err: String(err) })
  }

  return models
}
