import type { Env, QueueMessage } from "./types";
import { analyze } from "./analyze";
import { fullReport, shortReport } from "./report";
import { loadSettings, publicSettings, saveSettings, type Settings } from "./settings";
import { DEFAULT_MODELS, OPENAI_COMPATIBLE_PRESETS, aiConfigured, generateText } from "./ai";
import { MAX_BATCH, createBatch, deleteBatch, exportBatch, getBatch, listBatches, parseUrlList, retryFailed, runItem } from "./batch";
import { fingerprintCount } from "./stack/detect";
import { errorMessage } from "./lib/http";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const text = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < Math.max(ab.length, bb.length); i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

function authorized(req: Request, env: Env): boolean {
  if (!env.ACCESS_TOKEN) return true;
  const header = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const query = new URL(req.url).searchParams.get("token") ?? "";
  return timingSafeEqual(header || query, env.ACCESS_TOKEN);
}

async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Request body must be JSON");
  }
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function handleAnalyze(req: Request, env: Env): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const input =
    req.method === "POST"
      ? await body<{ url?: string; format?: string; skipPagespeed?: boolean; skipAi?: boolean }>(req)
      : { url: params.get("url") ?? "", format: params.get("format") ?? "json", skipPagespeed: params.has("skipPagespeed"), skipAi: params.has("skipAi") };
  if (!input.url) throw new HttpError(400, "Missing url");
  let result;
  try {
    result = await analyze(env, input.url, { skipPagespeed: input.skipPagespeed, skipAi: input.skipAi });
  } catch (err) {
    throw new HttpError(400, errorMessage(err));
  }
  if (input.format === "text") return text(shortReport(result));
  if (input.format === "full") return text(fullReport(result));
  return json({ result, report: shortReport(result), fullReport: fullReport(result) });
}

async function handleApi(req: Request, env: Env, path: string): Promise<Response> {
  const m = req.method;

  if (path === "/api/health") return json({ ok: true, fingerprints: fingerprintCount() });

  if (path === "/api/analyze" && (m === "POST" || m === "GET")) return handleAnalyze(req, env);

  if (path === "/api/settings" && m === "GET") {
    return json({ settings: publicSettings(await loadSettings(env), env), presets: OPENAI_COMPATIBLE_PRESETS, defaultModels: DEFAULT_MODELS });
  }
  if (path === "/api/settings" && m === "PUT") {
    const saved = await saveSettings(env, await body<Partial<Settings>>(req));
    return json({ settings: publicSettings(saved, env) });
  }
  if (path === "/api/settings/test-ai" && m === "POST") {
    const settings = await loadSettings(env);
    if (!aiConfigured(settings, env)) throw new HttpError(400, "AI provider is not fully configured (provider, API key, base URL and model)");
    const start = Date.now();
    const out = await generateText(env, settings, "Reply with exactly: OK", "Say OK.");
    return json({ ok: true, provider: out.provider, reply: out.text.slice(0, 200), ms: Date.now() - start });
  }

  if (path === "/api/batches" && m === "GET") return json({ batches: await listBatches(env) });
  if (path === "/api/batches" && m === "POST") {
    const input = await body<{ name?: string; urls?: string | string[] }>(req);
    const raw = Array.isArray(input.urls) ? input.urls.join("\n") : (input.urls ?? "");
    const { urls, invalid } = parseUrlList(raw);
    if (!urls.length) throw new HttpError(400, "No valid URLs found");
    if (urls.length > MAX_BATCH) throw new HttpError(400, `Max ${MAX_BATCH} URLs per batch (got ${urls.length})`);
    const created = await createBatch(env, input.name ?? "", urls);
    return json({ ...created, total: urls.length, invalid }, 201);
  }

  const batchMatch = path.match(/^\/api\/batches\/([0-9a-f-]{36})(?:\/(.*))?$/);
  if (batchMatch) {
    const [, id, rest = ""] = batchMatch;
    if (!rest && m === "GET") {
      const batch = await getBatch(env, id);
      return batch ? json(batch) : json({ error: "Batch not found" }, 404);
    }
    if (!rest && m === "DELETE") {
      await deleteBatch(env, id);
      return json({ ok: true });
    }
    if (rest === "retry" && m === "POST") return json({ requeued: await retryFailed(env, id) });
    if (rest === "export" && m === "GET") {
      const format = (new URL(req.url).searchParams.get("format") ?? "csv") as "csv" | "txt" | "json";
      return (await exportBatch(env, id, ["csv", "txt", "json"].includes(format) ? format : "csv")) ?? json({ error: "Batch not found" }, 404);
    }
    const itemMatch = rest.match(/^items\/([0-9a-f-]{36})\/run$/);
    if (itemMatch && m === "POST") {
      const item = await runItem(env, itemMatch[1]);
      return item ? json({ item }) : json({ error: "Item not found" }, 404);
    }
  }

  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS ? env.ASSETS.fetch(req) : text("Not found", 404);
    }
    if (url.pathname !== "/api/health" && !authorized(req, env)) return json({ error: "Unauthorized" }, 401);
    try {
      return await handleApi(req, env, url.pathname.replace(/\/+$/, ""));
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: errorMessage(err) }, 500);
    }
  },

  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        await runItem(env, msg.body.itemId);
        msg.ack();
      } catch (err) {
        console.error("queue item failed", msg.body, err);
        msg.retry({ delaySeconds: 30 });
      }
    }
  },
} satisfies ExportedHandler<Env, QueueMessage>;
