import Anthropic from "@anthropic-ai/sdk";
import type { AnalysisResult, Env, Finding } from "./types";
import type { Settings } from "./settings";
import { fetchWithTimeout } from "./lib/http";
import { platformLabel } from "./report";

/** OpenAI-compatible endpoints. Model names are suggestions only — use whatever your account offers. */
export const OPENAI_COMPATIBLE_PRESETS: { id: string; label: string; baseUrl: string; modelHint: string; keyUrl: string }[] = [
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", modelHint: "gpt-4o-mini", keyUrl: "https://platform.openai.com/api-keys" },
  { id: "gemini", label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", modelHint: "gemini-2.5-flash", keyUrl: "https://aistudio.google.com/apikey" },
  { id: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1", modelHint: "llama-3.3-70b-versatile", keyUrl: "https://console.groq.com/keys" },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", modelHint: "anthropic/claude-haiku-4.5", keyUrl: "https://openrouter.ai/keys" },
  { id: "mistral", label: "Mistral", baseUrl: "https://api.mistral.ai/v1", modelHint: "mistral-small-latest", keyUrl: "https://console.mistral.ai/api-keys" },
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", modelHint: "deepseek-chat", keyUrl: "https://platform.deepseek.com/api_keys" },
  { id: "together", label: "Together AI", baseUrl: "https://api.together.xyz/v1", modelHint: "meta-llama/Llama-3.3-70B-Instruct-Turbo", keyUrl: "https://api.together.ai/settings/api-keys" },
  { id: "xai", label: "xAI", baseUrl: "https://api.x.ai/v1", modelHint: "grok-3-mini", keyUrl: "https://console.x.ai" },
  { id: "custom", label: "Custom (any OpenAI-compatible URL)", baseUrl: "", modelHint: "", keyUrl: "" },
];

export const DEFAULT_MODELS = {
  anthropic: "claude-opus-5-5",
  "workers-ai": "@cf/meta/llama-3.1-8b-instruct",
};

const SYSTEM_PROMPT = `You write the opening line of a cold email to a business, based on an automated audit of their website.

Rules:
- Exactly one sentence, at most 30 words.
- Lead with the single most compelling, concrete problem; use a real number from the findings when there is one.
- Write to the business owner in second person ("your site…"). No greeting, no names, no sign-off.
- Only use facts from the findings. Never invent numbers, competitors, or claims.
- No exclamation marks, emojis, hype, or jargon the owner wouldn't understand (say "takes 6 seconds to load", not "LCP").
- Output only the sentence, without quotes.`;

export function buildHookPrompt(r: AnalysisResult, top: Finding[], settings: Settings): string {
  const facts = {
    website: r.host.replace(/^www\./, ""),
    business_name: r.businessName,
    platform: platformLabel(r),
    region: r.automation?.regionHint,
    worst_findings: top.map((f) => ({ category: f.category, finding: f.title, plain_english: f.hook, detail: f.detail?.slice(0, 300) })),
  };
  const lines = [`Audit findings:\n${JSON.stringify(facts, null, 2)}`];
  if (settings.outreach.senderContext) lines.push(`About the sender (what they offer — let the line set this up, don't pitch it):\n${settings.outreach.senderContext}`);
  if (settings.outreach.tone) lines.push(`Tone: ${settings.outreach.tone}`);
  if (settings.outreach.extraInstructions) lines.push(`Extra instructions: ${settings.outreach.extraInstructions}`);
  lines.push("Write the opening line now.");
  return lines.join("\n\n");
}

export function cleanHook(text: string): string {
  const firstLine = text.trim().split(/\n+/).find((l) => l.trim()) ?? "";
  return firstLine.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim().slice(0, 400);
}

export function aiConfigured(settings: Settings, env: Env): boolean {
  const ai = settings.ai;
  if (ai.provider === "workers-ai") return Boolean(env.AI);
  if (ai.provider === "anthropic") return Boolean(ai.apiKey);
  if (ai.provider === "openai-compatible") return Boolean(ai.apiKey && ai.baseUrl && ai.model);
  return false;
}

export async function generateText(env: Env, settings: Settings, system: string, user: string): Promise<{ text: string; provider: string }> {
  const ai = settings.ai;
  switch (ai.provider) {
    case "anthropic":
      return { text: await callAnthropic(ai.apiKey, ai.model || DEFAULT_MODELS.anthropic, system, user), provider: `anthropic/${ai.model || DEFAULT_MODELS.anthropic}` };
    case "openai-compatible":
      return { text: await callOpenAiCompatible(ai.baseUrl, ai.apiKey, ai.model, system, user), provider: `${ai.preset || "openai-compatible"}/${ai.model}` };
    case "workers-ai": {
      if (!env.AI) throw new Error("Workers AI binding (AI) is not configured in wrangler.toml");
      const model = ai.model || DEFAULT_MODELS["workers-ai"];
      const out = (await env.AI.run(model as Parameters<Ai["run"]>[0], {
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      } as never)) as { response?: string };
      return { text: out.response ?? "", provider: `workers-ai/${model}` };
    }
    default:
      throw new Error("No AI provider configured");
  }
}

// Models that accept server-side refusal fallbacks and effort control.
const FALLBACK_MODELS = /^claude-(fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/;
const NO_EFFORT_MODELS = /haiku-4-5|sonnet-4-5|-3-/;

async function callAnthropic(apiKey: string, model: string, system: string, user: string): Promise<string> {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 });
  const params = {
    model,
    max_tokens: 4000,
    system,
    messages: [{ role: "user" as const, content: user }],
    ...(NO_EFFORT_MODELS.test(model) ? {} : { output_config: { effort: "low" as const } }),
  };
  const message = FALLBACK_MODELS.test(model)
    ? await client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
    : await client.messages.create(params);
  if (message.stop_reason === "refusal") throw new Error("The model declined to write this hook");
  return message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

async function callOpenAiCompatible(baseUrl: string, apiKey: string, model: string, system: string, user: string): Promise<string> {
  const res = await fetchWithTimeout(
    `${baseUrl.replace(/\/+$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      // No max_tokens / temperature: reasoning models reject them, and the output is one sentence anyway.
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    },
    60_000,
  );
  const body = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } | string } | null;
  if (!res.ok) {
    const err = typeof body?.error === "string" ? body.error : body?.error?.message;
    throw new Error(`LLM request failed (${res.status}): ${err ?? "unknown error"}`);
  }
  return body?.choices?.[0]?.message?.content ?? "";
}

export async function generateHook(env: Env, settings: Settings, r: AnalysisResult, top: Finding[]): Promise<{ text: string; provider: string }> {
  const { text, provider } = await generateText(env, settings, SYSTEM_PROMPT, buildHookPrompt(r, top, settings));
  const hook = cleanHook(text);
  if (!hook) throw new Error("LLM returned an empty hook");
  return { text: hook, provider };
}
