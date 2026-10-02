import type { PageData, SeoResult } from "../types";
import { BROWSER_HEADERS, fetchWithTimeout, hostOf, readTextCapped, resolveUrl } from "../lib/http";
import { jsonLdTypes, metaContent } from "./html";

export function onPageSeo(page: PageData): Omit<SeoResult, "robotsTxt" | "sitemap" | "brokenLinks" | "score"> {
  const og: Record<string, string> = {};
  for (const m of page.metas) if (m.property?.startsWith("og:")) og[m.property.slice(3)] = m.content;
  const canonical = page.links.find((l) => l.rel.split(/\s+/).includes("canonical"))?.href ?? null;
  const description = metaContent(page, "description");
  return {
    title: page.title,
    titleLength: page.title?.length ?? 0,
    metaDescription: description,
    metaDescriptionLength: description?.length ?? 0,
    h1: page.headings.h1.filter(Boolean),
    canonical,
    lang: page.lang,
    viewport: metaContent(page, "viewport"),
    robotsMeta: metaContent(page, "robots"),
    og,
    twitterCard: metaContent(page, "twitter:card"),
    images: {
      total: page.images.length,
      missingAlt: page.images.filter((i) => i.alt === null && !/^data:/.test(i.src)).length,
    },
    jsonLdTypes: jsonLdTypes(page),
  };
}

export function parseRobots(body: string): { disallowAll: boolean; sitemaps: string[] } {
  const sitemaps = [...body.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  // Disallow: / inside the "User-agent: *" group.
  let inStar = false;
  let disallowAll = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const ua = line.match(/^user-agent:\s*(.+)$/i);
    if (ua) {
      inStar = ua[1].trim() === "*";
      continue;
    }
    if (inStar && /^disallow:\s*\/\s*$/i.test(line)) disallowAll = true;
  }
  return { disallowAll, sitemaps };
}

export async function checkRobots(origin: string): Promise<SeoResult["robotsTxt"]> {
  const res = await fetchWithTimeout(`${origin}/robots.txt`, { headers: BROWSER_HEADERS }, 8_000);
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || /html/i.test(type)) return { found: false, disallowAll: false, sitemaps: [] };
  const body = await readTextCapped(res, 200_000);
  return { found: true, ...parseRobots(body) };
}

export async function checkSitemap(origin: string, fromRobots: string[]): Promise<SeoResult["sitemap"]> {
  const candidates = [...new Set([...fromRobots.slice(0, 1), `${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`])].slice(0, 3);
  for (const url of candidates) {
    try {
      const res = await fetchWithTimeout(url, { headers: BROWSER_HEADERS }, 8_000);
      if (!res.ok) continue;
      const body = await readTextCapped(res, 2_000_000);
      if (!/<(urlset|sitemapindex)\b/i.test(body)) continue;
      return { found: true, url, urlCount: (body.match(/<loc>/gi) ?? []).length };
    } catch {
      /* try the next candidate */
    }
  }
  return { found: false, url: null, urlCount: null };
}

/** Picks a spread of internal and external links to probe. */
export function sampleLinks(page: PageData, baseUrl: string, limit: number): string[] {
  const host = hostOf(baseUrl);
  const internal: string[] = [];
  const external: string[] = [];
  const seen = new Set<string>();
  for (const a of page.anchors) {
    if (!a.href || /^(mailto|tel|javascript|sms|whatsapp|#)/i.test(a.href)) continue;
    const abs = resolveUrl(a.href, baseUrl);
    if (!abs || !/^https?:/.test(abs)) continue;
    const clean = abs.split("#")[0];
    if (seen.has(clean) || clean === baseUrl.split("#")[0]) continue;
    seen.add(clean);
    (hostOf(clean).replace(/^www\./, "") === host.replace(/^www\./, "") ? internal : external).push(clean);
  }
  const nInternal = Math.min(internal.length, Math.ceil(limit * 0.7));
  return [...internal.slice(0, nInternal), ...external.slice(0, limit - nInternal)];
}

export async function checkBrokenLinks(urls: string[]): Promise<NonNullable<SeoResult["brokenLinks"]>> {
  const broken: { url: string; status: number | string }[] = [];
  await Promise.all(
    urls.map(async (url) => {
      try {
        let res = await fetchWithTimeout(url, { method: "HEAD", headers: BROWSER_HEADERS, redirect: "follow" }, 8_000);
        // Some servers reject HEAD outright; retry those with GET.
        if ([403, 405, 501].includes(res.status)) res = await fetchWithTimeout(url, { headers: BROWSER_HEADERS, redirect: "follow" }, 8_000);
        await res.body?.cancel();
        // 401/403/429 usually mean bot protection or login, not a broken link.
        if (res.status === 404 || res.status === 410 || res.status >= 500) broken.push({ url, status: res.status });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/dns|resolve|ENOTFOUND|connect/i.test(msg)) broken.push({ url, status: "unreachable" });
      }
    }),
  );
  return { checked: urls.length, broken };
}

export function scoreSeo(s: Omit<SeoResult, "score">): number {
  let score = 100;
  if (!s.title) score -= 20;
  else if (s.titleLength < 15 || s.titleLength > 65) score -= 5;
  if (!s.metaDescription) score -= 12;
  else if (s.metaDescriptionLength < 50 || s.metaDescriptionLength > 170) score -= 3;
  if (s.h1.length === 0) score -= 10;
  else if (s.h1.length > 1) score -= 3;
  if (!s.canonical) score -= 5;
  if (!s.viewport) score -= 10;
  if (!s.lang) score -= 3;
  if (!s.og.title || !s.og.image) score -= 6;
  if (s.images.total && s.images.missingAlt / s.images.total > 0.3) score -= 6;
  if (!s.jsonLdTypes.length) score -= 6;
  if (s.robotsMeta && /noindex/i.test(s.robotsMeta)) score -= 40;
  if (s.robotsTxt && !s.robotsTxt.found) score -= 3;
  if (s.robotsTxt?.disallowAll) score -= 40;
  if (s.sitemap && !s.sitemap.found) score -= 6;
  if (s.brokenLinks?.broken.length) score -= Math.min(12, s.brokenLinks.broken.length * 4);
  return Math.max(0, score);
}
