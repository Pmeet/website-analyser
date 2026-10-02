import type { Env } from "./types";

export type AiProvider = "none" | "anthropic" | "openai-compatible" | "workers-ai";

export interface Settings {
  pagespeedApiKey: string;
  strategy: "mobile" | "desktop";
  brokenLinkSample: number;
  crawlContactPages: boolean;
  runObservatory: boolean;
  ai: {
    provider: AiProvider;
    /** Preset label for openai-compatible providers (OpenAI, Gemini, Groq, OpenRouter, …). */
    preset: string;
    baseUrl: string;
    apiKey: string;
    model: string;
  };
  outreach: {
    /** Who you are and what you sell — fed to the LLM so the hook fits your offer. */
    senderContext: string;
    tone: string;
    extraInstructions: string;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  pagespeedApiKey: "",
  strategy: "mobile",
  brokenLinkSample: 10,
  crawlContactPages: true,
  runObservatory: true,
  ai: { provider: "none", preset: "", baseUrl: "", apiKey: "", model: "" },
  outreach: {
    senderContext: "",
    tone: "friendly, specific, no hype",
    extraInstructions: "",
  },
};

export function mask(secret: string): string {
  if (!secret) return "";
  return secret.length <= 8 ? "••••" : `••••${secret.slice(-4)}`;
}

const isMasked = (v: unknown) => typeof v === "string" && v.startsWith("••••");

async function readStored(env: Env): Promise<Partial<Settings>> {
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'app'").first<{ value: string }>();
    return row ? (JSON.parse(row.value) as Partial<Settings>) : {};
  } catch {
    return {}; // table missing (migrations not applied) → defaults
  }
}

function withDefaults(stored: Partial<Settings>): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    ai: { ...DEFAULT_SETTINGS.ai, ...(stored.ai ?? {}) },
    outreach: { ...DEFAULT_SETTINGS.outreach, ...(stored.outreach ?? {}) },
  };
}

export async function loadSettings(env: Env): Promise<Settings> {
  const merged = withDefaults(await readStored(env));
  if (!merged.pagespeedApiKey && env.PAGESPEED_API_KEY) merged.pagespeedApiKey = env.PAGESPEED_API_KEY;
  return merged;
}

/** Settings as returned to the browser: secrets masked. */
export function publicSettings(s: Settings, env: Env) {
  return {
    ...s,
    pagespeedApiKey: mask(s.pagespeedApiKey),
    ai: { ...s.ai, apiKey: mask(s.ai.apiKey) },
    meta: {
      pagespeedKeyFromEnv: Boolean(env.PAGESPEED_API_KEY),
      workersAiAvailable: Boolean(env.AI),
      browserRendering: Boolean(env.CF_ACCOUNT_ID && env.CF_API_TOKEN),
      queueAvailable: Boolean(env.ANALYSIS_QUEUE),
      accessTokenSet: Boolean(env.ACCESS_TOKEN),
    },
  };
}

export async function saveSettings(env: Env, patch: Partial<Settings>): Promise<Settings> {
  // Merge onto what is stored (not env fallbacks) so env-provided keys are never persisted.
  const stored = withDefaults(await readStored(env));
  const next: Settings = {
    ...stored,
    ...stripUnknown(patch),
    ai: { ...stored.ai, ...(patch.ai ?? {}) },
    outreach: { ...stored.outreach, ...(patch.outreach ?? {}) },
  };
  // A masked value coming back from the UI means "unchanged".
  if (isMasked(next.pagespeedApiKey)) next.pagespeedApiKey = stored.pagespeedApiKey;
  if (isMasked(next.ai.apiKey)) next.ai.apiKey = stored.ai.apiKey;
  next.brokenLinkSample = Math.max(0, Math.min(20, Number(next.brokenLinkSample) || 0));
  if (next.strategy !== "desktop") next.strategy = "mobile";
  await env.DB.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES ('app', ?1, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  )
    .bind(JSON.stringify(next))
    .run();
  return loadSettings(env);
}

function stripUnknown(patch: Partial<Settings>): Partial<Settings> {
  const allowed = new Set(Object.keys(DEFAULT_SETTINGS));
  return Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.has(k) && k !== "ai" && k !== "outreach")) as Partial<Settings>;
}
