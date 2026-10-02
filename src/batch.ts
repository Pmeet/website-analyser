import type { AnalysisResult, Env } from "./types";
import { analyze } from "./analyze";
import { bestContact, topFindings } from "./findings";
import { errorMessage, normalizeUrl } from "./lib/http";
import { fullReport, platformLabel, shortReport } from "./report";
import { loadSettings } from "./settings";

export const MAX_BATCH = 200;

export interface BatchItemRow {
  id: string;
  batch_id: string;
  position: number;
  url: string;
  status: "pending" | "running" | "done" | "error";
  error: string | null;
  domain: string | null;
  performance: number | null;
  seo: number | null;
  security_grade: string | null;
  email_ok: number | null;
  stack: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  hook: string | null;
  report_text: string | null;
  started_at: string | null;
  finished_at: string | null;
}

/** Parses pasted text: one URL per line (commas/spaces also accepted), de-duplicated. */
export function parseUrlList(text: string): { urls: string[]; invalid: string[] } {
  const urls: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[\s,;]+/)) {
    const s = raw.trim();
    if (!s) continue;
    try {
      const u = normalizeUrl(s);
      const key = new URL(u).hostname.replace(/^www\./, "") + new URL(u).pathname.replace(/\/$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      urls.push(u);
    } catch {
      invalid.push(s);
    }
  }
  return { urls, invalid };
}

export async function createBatch(env: Env, name: string, urls: string[]): Promise<{ id: string; mode: "queue" | "client" }> {
  const id = crypto.randomUUID();
  const mode = env.ANALYSIS_QUEUE ? "queue" : "client";
  const items = urls.map((url, position) => ({ id: crypto.randomUUID(), url, position }));
  await env.DB.batch([
    env.DB.prepare("INSERT INTO batches (id, name, mode, total) VALUES (?1, ?2, ?3, ?4)").bind(id, name || null, mode, urls.length),
    ...items.map((it) =>
      env.DB.prepare("INSERT INTO batch_items (id, batch_id, position, url) VALUES (?1, ?2, ?3, ?4)").bind(it.id, id, it.position, it.url),
    ),
  ]);
  if (env.ANALYSIS_QUEUE) {
    // sendBatch accepts up to 100 messages per call.
    for (let i = 0; i < items.length; i += 100) {
      await env.ANALYSIS_QUEUE.sendBatch(items.slice(i, i + 100).map((it) => ({ body: { batchId: id, itemId: it.id } })));
    }
  }
  return { id, mode };
}

export async function runItem(env: Env, itemId: string): Promise<BatchItemRow | null> {
  const item = await env.DB.prepare("SELECT * FROM batch_items WHERE id = ?1").bind(itemId).first<BatchItemRow>();
  if (!item) return null;
  if (item.status === "done") return item;
  await env.DB.prepare("UPDATE batch_items SET status = 'running', started_at = datetime('now'), error = NULL WHERE id = ?1").bind(itemId).run();
  try {
    const settings = await loadSettings(env);
    const result = await analyze(env, item.url, { settings });
    await saveResult(env, itemId, result);
  } catch (err) {
    await env.DB.prepare("UPDATE batch_items SET status = 'error', error = ?2, finished_at = datetime('now') WHERE id = ?1")
      .bind(itemId, errorMessage(err))
      .run();
  }
  return env.DB.prepare("SELECT * FROM batch_items WHERE id = ?1").bind(itemId).first<BatchItemRow>();
}

async function saveResult(env: Env, itemId: string, r: AnalysisResult) {
  const contact = bestContact(r);
  const status = r.fetch.error && !r.fetch.status ? "error" : "done";
  await env.DB.prepare(
    `UPDATE batch_items SET status = ?2, error = ?3, domain = ?4, performance = ?5, seo = ?6, security_grade = ?7,
       email_ok = ?8, stack = ?9, contact_email = ?10, contact_phone = ?11, hook = ?12, report_text = ?13,
       result_json = ?14, finished_at = datetime('now') WHERE id = ?1`,
  )
    .bind(
      itemId,
      status,
      r.fetch.error ?? null,
      r.host.replace(/^www\./, ""),
      r.scores.performance,
      r.scores.seo,
      r.security ? r.scores.security.grade : null,
      r.email ? Number(Boolean(r.email.spf.record && r.email.dmarc.record)) : null,
      platformLabel(r),
      contact.email ?? null,
      contact.phone ?? null,
      r.hook?.text ?? null,
      shortReport(r),
      JSON.stringify(r),
    )
    .run();
}

export async function getBatch(env: Env, id: string) {
  const batch = await env.DB.prepare("SELECT * FROM batches WHERE id = ?1").bind(id).first();
  if (!batch) return null;
  const { results } = await env.DB.prepare(
    `SELECT id, position, url, status, error, domain, performance, seo, security_grade, email_ok, stack,
            contact_email, contact_phone, hook, report_text, started_at, finished_at
       FROM batch_items WHERE batch_id = ?1 ORDER BY position`,
  )
    .bind(id)
    .all<BatchItemRow>();
  const counts = { pending: 0, running: 0, done: 0, error: 0 };
  for (const r of results) counts[r.status]++;
  return { batch, counts, items: results };
}

export async function listBatches(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT b.id, b.name, b.mode, b.total, b.created_at,
            SUM(CASE WHEN i.status IN ('done','error') THEN 1 ELSE 0 END) AS finished
       FROM batches b LEFT JOIN batch_items i ON i.batch_id = b.id
      GROUP BY b.id ORDER BY b.created_at DESC LIMIT 50`,
  ).all();
  return results;
}

export async function deleteBatch(env: Env, id: string) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM batch_items WHERE batch_id = ?1").bind(id),
    env.DB.prepare("DELETE FROM batches WHERE id = ?1").bind(id),
  ]);
}

export async function retryFailed(env: Env, id: string): Promise<number> {
  const { results } = await env.DB.prepare("SELECT id FROM batch_items WHERE batch_id = ?1 AND status = 'error'").bind(id).all<{ id: string }>();
  if (!results.length) return 0;
  await env.DB.prepare("UPDATE batch_items SET status = 'pending', error = NULL WHERE batch_id = ?1 AND status = 'error'").bind(id).run();
  if (env.ANALYSIS_QUEUE) await env.ANALYSIS_QUEUE.sendBatch(results.map((r) => ({ body: { batchId: id, itemId: r.id } })));
  return results.length;
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function exportBatch(env: Env, id: string, format: "csv" | "txt" | "json"): Promise<Response | null> {
  const { results } = await env.DB.prepare("SELECT * FROM batch_items WHERE batch_id = ?1 ORDER BY position").bind(id).all<BatchItemRow & { result_json: string | null }>();
  if (!results.length) return null;
  const parsed = results.map((r) => ({ row: r, result: r.result_json ? (JSON.parse(r.result_json) as AnalysisResult) : null }));
  const filename = `website-analysis-${id.slice(0, 8)}`;

  if (format === "json") {
    return new Response(JSON.stringify(parsed.map((p) => p.result ?? { url: p.row.url, status: p.row.status, error: p.row.error }), null, 2), {
      headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${filename}.json"` },
    });
  }
  if (format === "txt") {
    const body = parsed
      .map(({ row, result }) => (result ? fullReport(result) : `${row.url}\n! ${row.status}${row.error ? `: ${row.error}` : ""}`))
      .join(`\n\n${"=".repeat(72)}\n\n`);
    return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="${filename}.txt"` } });
  }
  const header = ["url", "domain", "status", "platform", "performance", "seo", "security", "spf", "dmarc", "top_issue_1", "top_issue_2", "top_issue_3", "email", "phone", "whatsapp", "linkedin", "hook", "error"];
  const lines = [header.join(",")];
  for (const { row, result } of parsed) {
    const top = result ? topFindings(result.findings, 3).map((f) => f.title) : [];
    lines.push(
      [
        row.url,
        row.domain,
        row.status,
        row.stack,
        row.performance,
        row.seo,
        row.security_grade,
        result?.email ? (result.email.spf.record ? "yes" : "no") : "",
        result?.email ? (result.email.dmarc.record ? result.email.dmarc.policy ?? "yes" : "no") : "",
        top[0],
        top[1],
        top[2],
        row.contact_email,
        row.contact_phone,
        result?.contacts?.whatsapp[0],
        result?.contacts?.socials.linkedin,
        row.hook,
        row.error,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return new Response(lines.join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}.csv"` } });
}
