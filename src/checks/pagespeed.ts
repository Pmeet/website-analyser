import type { PageSpeedResult } from "../types";
import { fetchWithTimeout } from "../lib/http";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Audit = {
  id: string;
  title: string;
  score: number | null;
  scoreDisplayMode?: string;
  displayValue?: string;
  numericValue?: number;
  details?: any;
  metricSavings?: Record<string, number>;
};

const METRIC_AUDITS = new Set([
  "first-contentful-paint",
  "largest-contentful-paint",
  "speed-index",
  "total-blocking-time",
  "cumulative-layout-shift",
  "interactive",
  "max-potential-fid",
  "first-meaningful-paint",
]);

export async function runPageSpeed(url: string, apiKey: string | undefined, strategy: "mobile" | "desktop" = "mobile"): Promise<PageSpeedResult> {
  const params = new URLSearchParams({ url, strategy });
  for (const c of ["performance", "seo", "accessibility", "best-practices"]) params.append("category", c);
  if (apiKey) params.set("key", apiKey);
  const res = await fetchWithTimeout(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`, {}, 60_000);
  const body = (await res.json().catch(() => null)) as any;
  if (!res.ok || !body?.lighthouseResult) {
    const msg = body?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`PageSpeed: ${msg}${!apiKey && res.status === 429 ? " (add a PageSpeed API key in Settings)" : ""}`);
  }
  return parsePageSpeed(body, strategy);
}

const score = (c: any): number | null => (typeof c?.score === "number" ? Math.round(c.score * 100) : null);

export function parsePageSpeed(body: any, strategy: "mobile" | "desktop"): PageSpeedResult {
  const lh = body.lighthouseResult;
  const audits: Record<string, Audit> = lh.audits ?? {};
  const cats = lh.categories ?? {};
  const num = (id: string) => (typeof audits[id]?.numericValue === "number" ? audits[id].numericValue : undefined);

  const result: PageSpeedResult = {
    strategy,
    scores: {
      performance: score(cats.performance),
      seo: score(cats.seo),
      accessibility: score(cats.accessibility),
      bestPractices: score(cats["best-practices"]),
    },
    lab: {
      lcpMs: num("largest-contentful-paint"),
      fcpMs: num("first-contentful-paint"),
      cls: num("cumulative-layout-shift"),
      tbtMs: num("total-blocking-time"),
      speedIndexMs: num("speed-index"),
      ttiMs: num("interactive"),
    },
    field: parseField(body),
    totalBytes: num("total-byte-weight"),
    opportunities: [],
    failedAudits: [],
  };

  result.lcpElement = parseLcpElement(audits);

  // Version-agnostic: anything in the performance category that failed and reports savings.
  const perfRefs: string[] = (cats.performance?.auditRefs ?? []).map((r: any) => r.id);
  for (const id of perfRefs) {
    const a = audits[id];
    if (!a || METRIC_AUDITS.has(id) || a.score === null || a.score >= 0.9) continue;
    if (a.scoreDisplayMode === "informative" || a.scoreDisplayMode === "notApplicable" || a.scoreDisplayMode === "manual") continue;
    const savingsMs = a.details?.overallSavingsMs ?? a.metricSavings?.LCP ?? a.metricSavings?.FCP;
    const savingsBytes = a.details?.overallSavingsBytes;
    result.opportunities.push({
      id,
      title: a.title,
      displayValue: a.displayValue,
      savingsMs: typeof savingsMs === "number" ? Math.round(savingsMs) : undefined,
      savingsBytes: typeof savingsBytes === "number" ? Math.round(savingsBytes) : undefined,
    });
  }
  result.opportunities.sort((a, b) => (b.savingsMs ?? 0) - (a.savingsMs ?? 0) || (b.savingsBytes ?? 0) - (a.savingsBytes ?? 0));

  for (const [catKey, cat] of Object.entries<any>(cats)) {
    if (catKey === "performance") continue;
    for (const ref of cat.auditRefs ?? []) {
      const a = audits[ref.id];
      if (!a || a.score === null || a.score >= 0.9 || a.scoreDisplayMode === "informative" || a.scoreDisplayMode === "manual" || a.scoreDisplayMode === "notApplicable") continue;
      if (!ref.weight) continue;
      result.failedAudits.push({ id: ref.id, title: a.title, category: catKey, displayValue: a.displayValue });
    }
  }
  return result;
}

function parseField(body: any): PageSpeedResult["field"] {
  const urlLevel = body.loadingExperience;
  const origin = body.originLoadingExperience;
  const useUrl = urlLevel?.metrics && !urlLevel.origin_fallback;
  const src = useUrl ? urlLevel : origin?.metrics ? origin : null;
  const field: PageSpeedResult["field"] = { source: src ? (useUrl ? "url" : "origin") : null, categories: {} };
  if (!src) return field;
  const m = src.metrics;
  const pct = (k: string) => (typeof m[k]?.percentile === "number" ? m[k].percentile : undefined);
  field.overall = src.overall_category;
  field.lcpMs = pct("LARGEST_CONTENTFUL_PAINT_MS");
  field.inpMs = pct("INTERACTION_TO_NEXT_PAINT");
  const cls = pct("CUMULATIVE_LAYOUT_SHIFT_SCORE");
  field.cls = cls !== undefined ? cls / 100 : undefined;
  field.fcpMs = pct("FIRST_CONTENTFUL_PAINT_MS");
  field.ttfbMs = pct("EXPERIMENTAL_TIME_TO_FIRST_BYTE");
  for (const [k, v] of Object.entries<any>(m)) if (v?.category) field.categories[k] = v.category;
  return field;
}

/** Finds the LCP element and, when it's an image, how heavy that image is. */
function parseLcpElement(audits: Record<string, Audit>): PageSpeedResult["lcpElement"] {
  const candidates = [audits["largest-contentful-paint-element"], audits["lcp-breakdown-insight"], audits["lcp-discovery-insight"]];
  let node: any;
  for (const a of candidates) {
    node = findNode(a?.details);
    if (node) break;
  }
  if (!node) return undefined;
  const snippet: string | undefined = node.snippet;
  const out: NonNullable<PageSpeedResult["lcpElement"]> = { snippet, label: node.nodeLabel };
  const src = snippet?.match(/\s(?:src|data-src)="([^"]+)"/i)?.[1] ?? snippet?.match(/url\(&quot;([^&]+)&quot;\)|url\(["']?([^"')]+)/i)?.slice(1).find(Boolean);
  if (src) {
    out.imageUrl = src;
    const file = src.split("?")[0].split("/").pop() ?? src;
    const requests: any[] = audits["network-requests"]?.details?.items ?? [];
    const hit = requests.find((r) => typeof r.url === "string" && file.length > 3 && r.url.includes(file));
    const bytes = hit?.resourceSize ?? hit?.transferSize;
    if (typeof bytes === "number") out.imageBytes = bytes;
  }
  return out;
}

function findNode(details: any, depth = 0): any {
  if (!details || depth > 5) return undefined;
  if (details.type === "node" && details.snippet) return details;
  if (details.node?.type === "node") return details.node;
  for (const key of ["items", "nodes"]) {
    if (Array.isArray(details[key])) {
      for (const item of details[key]) {
        const found = findNode(item, depth + 1);
        if (found) return found;
      }
    }
  }
  return undefined;
}
