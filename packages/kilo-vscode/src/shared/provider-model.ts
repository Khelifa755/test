// ── TunisCode: Ollama-first, no gateway ──────────────────────────────────────

export const KILO_PROVIDER_ID = "ollama"  // keep export name, change value only

export const KILO_AUTO = { 
  providerID: KILO_PROVIDER_ID, 
  modelID: "qwen2.5-coder:7b-instruct-q4_K_M"  // was "kilo-auto/free"
} as const

export const CUSTOM_PROVIDER_PACKAGES = [
  "@ai-sdk/openai-compatible", 
  "@ai-sdk/openai", 
  "@ai-sdk/anthropic"
] as const
export type CustomProviderPackage = (typeof CUSTOM_PROVIDER_PACKAGES)[number]
export const CUSTOM_PROVIDER_PACKAGE: CustomProviderPackage = "@ai-sdk/openai-compatible"
export const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-_]*$/

export const PROVIDER_PRIORITY = [
  KILO_PROVIDER_ID,   // "ollama" — always first
  "anthropic",
  "deepseek",
  "openai",
  "google",
  "minimax",          // your cloud test fallback
  "openrouter",
  "vercel",
] as const

export function isCustomProviderPackage(value: unknown): value is CustomProviderPackage {
  return CUSTOM_PROVIDER_PACKAGES.includes(value as CustomProviderPackage)
}

export function parseModelString(raw: string | undefined | null) {
  if (!raw) return null
  const slash = raw.indexOf("/")
  if (slash <= 0 || slash >= raw.length - 1) return null
  return { providerID: raw.slice(0, slash), modelID: raw.slice(slash + 1) }
}

export function providerOrderIndex(providerID: string, order = PROVIDER_PRIORITY) {
  const index = order.indexOf(providerID.toLowerCase() as (typeof PROVIDER_PRIORITY)[number])
  return index >= 0 ? index : order.length
}

// Replaces createKiloFallbackProvider — now points to local Ollama
export function createKiloFallbackProvider() {
  return {
    id: KILO_PROVIDER_ID,          // "ollama"
    name: "Ollama (Local)",        // was "Kilo Gateway"
    source: "custom" as const,
    env: [],                       // no API key needed for local Ollama
    metadata: {
      noteKey: "settings.providers.note.ollama",
      icon: "ollama",
      priority: 0,
    },
    models: {},
  }
}

// ── Ollama connection config ──────────────────────────────────────────────────
export const OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1"

export const OLLAMA_DEFAULT_MODEL =
  process.env.OLLAMA_MODEL ?? "qwen2.5-coder:7b-instruct-q4_K_M"