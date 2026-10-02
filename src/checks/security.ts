import type { FetchedPage, PageData, SecurityResult, Tech } from "../types";
import { BROWSER_HEADERS, fetchWithTimeout, resolveUrl } from "../lib/http";
import { metaContent } from "./html";

export const SECURITY_HEADERS = [
  "strict-transport-security",
  "content-security-policy",
  "x-frame-options",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
] as const;

export function inspectHeaders(headers: Record<string, string>) {
  const found: Record<string, string | null> = {};
  for (const h of SECURITY_HEADERS) found[h] = headers[h] ?? null;
  // CSP frame-ancestors is the modern equivalent of X-Frame-Options.
  const csp = found["content-security-policy"];
  const missing = SECURITY_HEADERS.filter((h) => {
    if (found[h]) return false;
    if (h === "x-frame-options" && csp && /frame-ancestors/i.test(csp)) return false;
    return true;
  });
  return { found, missing: [...missing] as string[] };
}

export function findMixedContent(page: PageData, finalUrl: string): string[] {
  if (!finalUrl.startsWith("https:")) return [];
  const candidates = [
    ...page.scripts.map((s) => s.src),
    ...page.images.map((i) => i.src),
    ...page.iframes,
    ...page.stylesheets,
    ...page.forms.map((f) => f.action),
  ];
  const out = new Set<string>();
  for (const c of candidates) {
    if (c && /^http:\/\//i.test(c.trim()) && !/^http:\/\/(localhost|127\.)/i.test(c)) out.add(c.trim());
  }
  return [...out].slice(0, 20);
}

export function findExposedVersions(page: PageData, headers: Record<string, string>, stack: Tech[]): string[] {
  const out = new Set<string>();
  const generator = metaContent(page, "generator");
  if (generator && /\d/.test(generator)) out.add(`Generator meta: ${generator}`);
  const powered = headers["x-powered-by"];
  if (powered && /\d/.test(powered)) out.add(`X-Powered-By: ${powered}`);
  const server = headers["server"];
  if (server && /\/\d/.test(server)) out.add(`Server: ${server}`);
  if (headers["x-aspnet-version"]) out.add(`X-AspNet-Version: ${headers["x-aspnet-version"]}`);

  // WordPress plugin/theme versions leaked via ?ver= on their assets.
  const assets = [...page.scripts.map((s) => s.src ?? ""), ...page.stylesheets];
  const plugins = new Map<string, string>();
  for (const a of assets) {
    const m = a.match(/\/wp-content\/(plugins|themes)\/([^/]+)\/[^?]*\?ver=([\d.]+)/i);
    if (m && !plugins.has(m[2])) plugins.set(m[2], `${m[1] === "themes" ? "theme" : "plugin"} ${m[2]} ${m[3]}`);
  }
  [...plugins.values()].slice(0, 6).forEach((p) => out.add(`WordPress ${p}`));

  for (const t of stack) {
    if (t.version && t.categories.some((c) => ["CMS", "Ecommerce", "Web servers", "Programming languages"].includes(c))) {
      const already = [...out].some((x) => x.toLowerCase().includes(t.name.toLowerCase().split(" ")[0]) && x.includes(t.version as string));
      if (!already) out.add(`${t.name} ${t.version}`);
    }
  }
  return [...out];
}

export async function checkHttpRedirect(host: string): Promise<boolean | null> {
  try {
    const res = await fetchWithTimeout(`http://${host}/`, { redirect: "manual", headers: BROWSER_HEADERS }, 8_000);
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) return (resolveUrl(loc, `http://${host}/`) ?? "").startsWith("https:");
    return false;
  } catch {
    return null;
  }
}

/** Certificate transparency lookup (crt.sh). Best effort: the newest cert covering the host. */
export async function checkCertificate(host: string): Promise<SecurityResult["certificate"]> {
  const res = await fetchWithTimeout(`https://crt.sh/?q=${encodeURIComponent(host)}&output=json&exclude=expired&deduplicate=Y`, {}, 12_000);
  if (!res.ok) throw new Error(`crt.sh HTTP ${res.status}`);
  const certs = (await res.json()) as { name_value: string; not_before: string; not_after: string; issuer_name: string }[];
  const parent = host.split(".").slice(1).join(".");
  const covering = certs.filter((c) =>
    c.name_value.split("\n").some((n) => n.toLowerCase() === host || n.toLowerCase() === `*.${parent}`),
  );
  covering.sort((a, b) => b.not_before.localeCompare(a.not_before));
  const cert = covering[0];
  if (!cert) return null;
  const notAfter = cert.not_after.endsWith("Z") ? cert.not_after : `${cert.not_after}Z`;
  const daysLeft = Math.floor((Date.parse(notAfter) - Date.now()) / 86_400_000);
  const issuer = cert.issuer_name.match(/O=([^,]+)/)?.[1]?.replace(/"/g, "") ?? cert.issuer_name;
  return { issuer, notAfter, daysLeft, source: "crt.sh" };
}

/** Mozilla HTTP Observatory v2. */
export async function runObservatory(host: string): Promise<NonNullable<SecurityResult["observatory"]>> {
  const res = await fetchWithTimeout(`https://observatory-api.mdn.mozilla.net/api/v2/scan?host=${encodeURIComponent(host)}`, { method: "POST" }, 30_000);
  const body = (await res.json().catch(() => null)) as {
    grade?: string;
    score?: number;
    tests_failed?: number;
    tests_passed?: number;
    details_url?: string;
    error?: string | null;
    message?: string;
  } | null;
  if (!res.ok || !body?.grade) throw new Error(`Observatory: ${body?.error ?? body?.message ?? `HTTP ${res.status}`}`);
  return {
    grade: body.grade,
    score: body.score ?? 0,
    testsFailed: body.tests_failed ?? 0,
    testsPassed: body.tests_passed ?? 0,
    detailsUrl: body.details_url,
  };
}

/** Same grade bands as the Observatory. */
export function gradeFor(score: number): string {
  const bands: [number, string][] = [
    [100, "A+"], [90, "A"], [85, "A-"], [80, "B+"], [70, "B"], [65, "B-"],
    [60, "C+"], [50, "C"], [45, "C-"], [40, "D+"], [30, "D"], [25, "D-"],
  ];
  return bands.find(([min]) => score >= min)?.[1] ?? "F";
}

export function internalSecurityScore(s: Omit<SecurityResult, "internalScore" | "internalGrade" | "observatory">): number {
  let score = 100;
  if (!s.https) score -= 50;
  if (s.httpRedirectsToHttps === false) score -= 20;
  if (s.tlsError) score -= 40;
  const penalties: Record<string, number> = {
    "strict-transport-security": 15,
    "content-security-policy": 15,
    "x-frame-options": 10,
    "x-content-type-options": 5,
    "referrer-policy": 5,
    "permissions-policy": 3,
  };
  for (const h of s.missingHeaders) score -= penalties[h] ?? 0;
  if (s.mixedContent.length) score -= 15;
  score -= Math.min(15, s.exposedVersions.length * 5);
  if (s.certificate?.daysLeft !== undefined && s.certificate.daysLeft < 14) score -= 20;
  return Math.max(0, score);
}

export function buildSecurityResult(
  fetched: FetchedPage,
  page: PageData,
  stack: Tech[],
  extra: { httpRedirectsToHttps: boolean | null; certificate: SecurityResult["certificate"]; observatory: SecurityResult["observatory"]; tlsError: string | null },
): SecurityResult {
  const { found, missing } = inspectHeaders(fetched.headers);
  const base = {
    https: fetched.finalUrl.startsWith("https:"),
    httpRedirectsToHttps: extra.httpRedirectsToHttps,
    headers: found,
    missingHeaders: missing,
    mixedContent: findMixedContent(page, fetched.finalUrl),
    exposedVersions: findExposedVersions(page, fetched.headers, stack),
    certificate: extra.certificate,
    tlsError: extra.tlsError,
  };
  const internalScore = internalSecurityScore(base);
  return { ...base, observatory: extra.observatory, internalScore, internalGrade: gradeFor(internalScore) };
}

