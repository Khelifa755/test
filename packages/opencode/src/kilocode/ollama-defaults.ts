// kilocode_change - new file

/** Shared Ollama-first defaults for repo config, global seed, and postinstall setup. */
export const OLLAMA_DEFAULT_MODEL = "minimax-m3:cloud"
export const OLLAMA_DEFAULT_SMALL = "gemma4:31b-cloud"

export const OLLAMA_DEFAULT_BASE =
  typeof process !== "undefined" && process.platform === "win32"
    ? "http://127.0.0.1:11434/v1"
    : "http://localhost:11434/v1"

export const OLLAMA_DEFAULT_CONFIG = {
  $schema: "https://app.kilo.ai/config.json",
  model: `ollama/${OLLAMA_DEFAULT_MODEL}`,
  small_model: `ollama/${OLLAMA_DEFAULT_SMALL}`,
  enabled_providers: ["ollama"],
  disabled_providers: ["kilo"],
  provider: {
    ollama: {
      options: {
        baseURL: OLLAMA_DEFAULT_BASE,
      },
    },
  },
} as const
