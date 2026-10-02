import type { AnalysisResult, CheckStatus, Env, FetchedPage, PageData, Tech } from "./types";
import { errorMessage, hostOf, normalizeUrl, registrableDomain, timed } from "./lib/http";
import { browserRenderingConfigured, fetchPage, looksJsRendered, renderWithBrowser } from "./checks/fetchPage";
import { extractPage, jsonLdNodes, metaContent } from "./checks/html";
import { runPageSpeed } from "./checks/pagespeed";
import { checkEmail } from "./checks/dns";
import { buildSecurityResult, checkCertificate, checkHttpRedirect, runObservatory } from "./checks/security";
import { checkBrokenLinks, checkRobots, checkSitemap, onPageSeo, sampleLinks, scoreSeo } from "./checks/seo";
import { discoverContactPages, extractContacts } from "./checks/contacts";
import { analyseAutomation, analyseExtras, domainAge } from "./checks/automation";
import { detectStack, mergeStacks } from "./stack/detect";
import { buildFindings, computeScores, templateHook, topFindings } from "./findings";
import { loadSettings, type Settings } from "./settings";
import { aiConfigured, generateHook } from "./ai";

export interface AnalyzeOptions {
  settings?: Settings;
  skipPagespeed?: boolean;
  skipAi?: boolean;
}

const skip = (checks: Record<string, CheckStatus>, name: string, reason: string) => {
  checks[name] = { ok: true, ms: 0, skipped: reason };
};

export function businessNameFrom(page: PageData | null): string | null {
  if (!page) return null;
  const site = metaContent(page, "og:site_name");
  if (site) return site;
  const org = jsonLdNodes(page).find(
    (n) => typeof n.name === "string" && (/Organization|LocalBusiness/i.test(JSON.stringify(n["@type"])) || Boolean(n.telephone || n.address)),
  );
  if (org) return org.name as string;
  const title = page.title?.split(/\s+[|–—-]\s+/) ?? [];
  return title.length > 1 ? (title[title.length - 1] ?? null) : null;
}

export async function analyze(env: Env, input: string, opts: AnalyzeOptions = {}): Promise<AnalysisResult> {
  const started = Date.now();
  const url = normalizeUrl(input);
  const host = hostOf(url);
  const domain = registrableDomain(host);
  const settings = opts.settings ?? (await loadSettings(env));
  const checks: Record<string, CheckStatus> = {};

  // Slow, independent lookups start immediately and run while we crawl the page.
  const pagespeedP = opts.skipPagespeed
    ? (skip(checks, "pagespeed", "disabled for this run"), Promise.resolve(null))
    : timed(checks, "pagespeed", () => runPageSpeed(url, settings.pagespeedApiKey || undefined, settings.strategy));
  const emailP = timed(checks, "email", () => checkEmail(domain));
  const observatoryP = settings.runObservatory
    ? timed(checks, "observatory", () => runObservatory(host))
    : (skip(checks, "observatory", "disabled in settings"), Promise.resolve(null));
  const certificateP = timed(checks, "certificate", () => checkCertificate(host));
  const domainAgeP = timed(checks, "domainAge", () => domainAge(domain));
  const redirectP = timed(checks, "httpRedirect", () => checkHttpRedirect(host));

  // ── Homepage ──────────────────────────────────────────────────────────────
  let fetched: FetchedPage | null = null;
  let fetchError: string | undefined;
  let tlsError: string | null = null;
  const fetchStart = Date.now();
  try {
    fetched = await fetchPage(url);
  } catch (err) {
    fetchError = errorMessage(err);
    // If https fails but http works, the certificate/TLS setup is the problem.
    try {
      fetched = await fetchPage(url.replace(/^https:/, "http:"));
      tlsError = fetchError;
      fetchError = undefined;
    } catch {
      /* site is down or unreachable */
    }
  }
  checks.fetch = fetched ? { ok: true, ms: fetched.ms } : { ok: false, ms: Date.now() - fetchStart, error: fetchError };

  let home: PageData | null = null;
  let jsRendered = false;
  if (fetched) {
    home = await extractPage(fetched.html, fetched.finalUrl, fetched.status);
    jsRendered = looksJsRendered(fetched.html, home.text);
    if ((jsRendered || fetched.blocked) && browserRenderingConfigured(env)) {
      const rendered = await timed(checks, "browserRendering", () => renderWithBrowser(env, fetched!.finalUrl));
      if (rendered) {
        fetched = { ...fetched, html: rendered, usedBrowserRendering: true, blocked: false };
        home = await extractPage(rendered, fetched.finalUrl, fetched.status);
      }
    }
  }
  const finalUrl = fetched?.finalUrl ?? url;
  const origin = new URL(finalUrl).origin;

  // ── Things that need the homepage ─────────────────────────────────────────
  const robotsP = fetched ? timed(checks, "robots", () => checkRobots(origin)) : Promise.resolve(null);
  const sitemapP = robotsP.then((robots) => (fetched ? timed(checks, "sitemap", () => checkSitemap(origin, robots?.sitemaps ?? [])) : null));
  const brokenP =
    home && settings.brokenLinkSample > 0
      ? timed(checks, "brokenLinks", () => checkBrokenLinks(sampleLinks(home!, finalUrl, settings.brokenLinkSample)))
      : Promise.resolve(null);
  const extraPagesP: Promise<PageData[]> =
    home && settings.crawlContactPages && !fetched?.blocked
      ? timed(checks, "contactPages", async () => {
          const urls = discoverContactPages(home!, finalUrl, 2);
          const pages = await Promise.all(
            urls.map(async (u) => {
              try {
                const p = await fetchPage(u, 10_000);
                if (p.status >= 400 || !p.html || p.blocked) return null;
                return await extractPage(p.html, p.finalUrl, p.status);
              } catch {
                return null;
              }
            }),
          );
          // Drop pages that just redirected back home.
          return pages.filter((p): p is PageData => p !== null && p.url.replace(/\/$/, "") !== finalUrl.replace(/\/$/, ""));
        }).then((x) => x ?? [])
      : Promise.resolve([]);

  let stack: Tech[] = [];
  if (home && fetched) {
    stack = (await timed(checks, "stack", () => detectStack({ page: home!, fetched: fetched! }))) ?? [];
  }
  const extraPages = await extraPagesP;
  if (extraPages.length && fetched) {
    const more = await Promise.all(extraPages.map((p) => detectStack({ page: p, fetched: { headers: {}, setCookies: [], finalUrl: p.url } }, { builtinOnly: true })));
    stack = mergeStacks(stack, ...more);
  }
  const pages = home ? [home, ...extraPages] : [];

  const [pagespeed, email, observatory, certificate, domainInfo, httpRedirectsToHttps, robotsTxt, sitemap, brokenLinks] = await Promise.all([
    pagespeedP,
    emailP,
    observatoryP,
    certificateP,
    domainAgeP,
    redirectP,
    robotsP,
    sitemapP,
    brokenP,
  ]);

  const seoBase = home ? { ...onPageSeo(home), robotsTxt, sitemap, brokenLinks } : null;
  const seo = seoBase ? { ...seoBase, score: scoreSeo(seoBase) } : null;
  const security =
    fetched && home
      ? buildSecurityResult(fetched, home, stack, { httpRedirectsToHttps, certificate, observatory, tlsError })
      : null;
  const contacts = pages.length ? extractContacts(pages, finalUrl) : null;
  const automation = pages.length ? analyseAutomation(stack, pages, finalUrl, contacts) : null;
  const extras = pages.length ? { ...analyseExtras(stack, pages, pagespeed), domain: domainInfo } : null;

  const result: AnalysisResult = {
    input,
    url,
    finalUrl,
    host,
    domain,
    businessName: businessNameFrom(home),
    analyzedAt: new Date().toISOString(),
    durationMs: 0,
    fetch: {
      status: fetched?.status ?? 0,
      error: fetchError,
      blocked: fetched?.blocked ?? false,
      jsRendered,
      usedBrowserRendering: fetched?.usedBrowserRendering ?? false,
      bytes: fetched?.html.length ?? 0,
      ms: fetched?.ms ?? 0,
    },
    scores: computeScores({ pagespeed, seo, security, email }),
    pagespeed,
    seo,
    security,
    email,
    stack,
    automation,
    contacts,
    extras,
    findings: [],
    hook: null,
    checks,
  };
  result.findings = buildFindings(result);

  // ── Outreach hook ─────────────────────────────────────────────────────────
  const fallback = templateHook(result.findings);
  if (!opts.skipAi && aiConfigured(settings, env) && result.findings.length) {
    const start = Date.now();
    try {
      const { text, provider } = await generateHook(env, settings, result, topFindings(result.findings, 3));
      result.hook = { text, source: "ai", provider };
      checks.ai = { ok: true, ms: Date.now() - start };
    } catch (err) {
      checks.ai = { ok: false, ms: Date.now() - start, error: errorMessage(err) };
      if (fallback) result.hook = { text: fallback, source: "template", error: errorMessage(err) };
    }
  } else if (fallback) {
    result.hook = { text: fallback, source: "template" };
  }

  result.durationMs = Date.now() - started;
  return result;
}
