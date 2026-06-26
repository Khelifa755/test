import type { ModelSelection } from "../../types/messages"
import type { EnrichedModel } from "../../context/provider"

// ── Ollama is now the primary local provider ──────────────────────────────────
export const KILO_GATEWAY_ID = "ollama"   // kept same export name so tests don't break

export const PROVIDER_ORDER = [
  "ollama",       // always first — local, no auth needed
  "anthropic",
  "deepseek",
  "openai",
  "google",
  "mistral",
  "groq",
  "minimax",      // your cloud fallback for testing
] as const

export type ProviderOrder = typeof PROVIDER_ORDER

export const OLLAMA_BASE_URL =
  (typeof process !== "undefined" && process.env?.OLLAMA_BASE_URL) ||
  "http://localhost:11434/v1"

export const OLLAMA_DEFAULT_MODEL =
  (typeof process !== "undefined" && process.env?.OLLAMA_MODEL) ||
  "qwen2.5-coder:7b-instruct-q4_K_M"

// These were Kilo-specific auto-routing model IDs — replaced with Ollama equivalents
export const KILO_AUTO_SMALL_IDS = new Set([
  "qwen2.5-coder:1.5b-instruct-q4_K_M",
  "qwen2.5:1.5b",
])

export function providerOrderIndex(
  providerID: string,
  order: readonly string[] = PROVIDER_ORDER,
): number {
  const idx = order.findIndex((p) => p.toLowerCase() === providerID.toLowerCase())
  return idx < 0 ? order.length : idx
}

export function providerSortKey(
  providerID: string,
  order: readonly string[] = PROVIDER_ORDER,
): number {
  return providerOrderIndex(providerID, order)
}

export function isSmall(model: Pick<EnrichedModel, "providerID" | "id">): boolean {
  return model.providerID === KILO_GATEWAY_ID && KILO_AUTO_SMALL_IDS.has(model.id)
}

export function isFree(model: Pick<EnrichedModel, "isFree">): boolean {
  return model.isFree === true
}

export function isDataCollectedModel(model: Pick<EnrichedModel, "mayTrainOnYourPrompts">): boolean {
  return model.mayTrainOnYourPrompts === true
}

export function hasByok(model: Pick<EnrichedModel, "hasUserByokAvailable">): boolean {
  return model.hasUserByokAvailable === true
}

export function freeDataLabel(_free: string, data: string): string {
  return data
}

// Strips trailing "(free)" from display names e.g. "Llama 3 (free)" → "Llama 3"
export function sanitizeName(name: string): string {
  return name.replace(/[\s:_-]*\(free\)\s*$/i, "").trim()
}

// For Ollama models served with a sub-provider prefix like "Ollama: qwen2.5-coder"
// we strip the prefix. For the provider itself we keep the name as-is.
export function stripSubProviderPrefix(name: string): string {
  const colon = name.indexOf(": ")
  if (colon < 0) return name
  const prefix = name.slice(0, colon)
  // Don't strip if prefix IS the gateway provider name
  if (prefix.toLowerCase() === KILO_GATEWAY_ID) return name
  return name.slice(colon + 2)
}

export function buildTriggerLabel(
  resolvedName: string | undefined,
  providerID: string | undefined,
  providerName: string | undefined,
  raw: ModelSelection | null,
  allowClear: boolean,
  clearLabel: string,
  hasProviders: boolean,
  labels: { select: string; noProviders: string; notSet: string },
): string {
  if (resolvedName) {
    if (providerID === KILO_GATEWAY_ID) return stripSubProviderPrefix(resolvedName)
    if (providerName) return `${providerName} / ${resolvedName}`
    return resolvedName
  }
  if (raw?.providerID && raw?.modelID) {
    return raw.providerID === KILO_GATEWAY_ID
      ? raw.modelID
      : `${raw.providerID} / ${raw.modelID}`
  }
  if (allowClear) return clearLabel || labels.notSet
  return hasProviders ? labels.select : labels.noProviders
}