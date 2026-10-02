import type { AnalysisResult, Finding, Scores, Severity } from "./types";
import { prettyPhone } from "./checks/contacts";
import { gradeFor } from "./checks/security";

export const fmtSec = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
export const fmtBytes = (b: number) => (b >= 1_000_000 ? `${(b / 1_000_000).toFixed(1)}MB` : `${Math.round(b / 1000)}KB`);

const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 100, high: 60, medium: 30, low: 10, info: 0 };

export function findingWeight(f: Finding): number {
  return SEVERITY_WEIGHT[f.severity] + (f.impact ?? 5);
}

type Input = Pick<
  AnalysisResult,
  "fetch" | "pagespeed" | "seo" | "security" | "email" | "automation" | "contacts" | "extras" | "stack" | "checks" | "host"
>;

export function buildFindings(r: Input): Finding[] {
  const out: Finding[] = [];
  const add = (f: Finding) => out.push(f);

  // ── Data quality ──────────────────────────────────────────────────────────
  if (r.fetch.blocked) {
    add({ id: "fetch-blocked", category: "data", severity: "info", title: `Site blocked the scraper (HTTP ${r.fetch.status}) — on-page results may be incomplete` });
  }
  if (r.fetch.jsRendered && !r.fetch.usedBrowserRendering) {
    add({ id: "fetch-js", category: "data", severity: "info", title: "Content is rendered by JavaScript — enable Browser Rendering for full results" });
  }

  // ── Performance ───────────────────────────────────────────────────────────
  const ps = r.pagespeed;
  if (ps) {
    const perf = ps.scores.performance;
    const lcp = ps.lab.lcpMs;
    if (lcp !== undefined && lcp > 2500) {
      const img = ps.lcpElement?.imageBytes && ps.lcpElement.imageBytes > 200_000 ? ` (hero image ${fmtBytes(ps.lcpElement.imageBytes)})` : "";
      add({
        id: "perf-lcp",
        category: "performance",
        severity: lcp > 4000 ? "high" : "medium",
        impact: lcp > 4000 ? 9 : 5,
        title: `LCP ${fmtSec(lcp)} on ${ps.strategy}${img}`,
        detail: "Largest Contentful Paint should be under 2.5s.",
        hook: `your homepage takes ~${Math.round(lcp / 1000)}s to show its main content on ${ps.strategy}${img ? `, mostly because of a ${fmtBytes(ps.lcpElement?.imageBytes ?? 0)} hero image` : ""}`,
      });
    } else if (perf !== null && perf < 50) {
      add({ id: "perf-score", category: "performance", severity: "high", title: `Performance score ${perf}/100 on ${ps.strategy}`, hook: `your site scores ${perf}/100 on Google's mobile speed test` });
    }
    if (ps.field.source && ps.field.overall === "SLOW") {
      const parts = [
        ps.field.lcpMs ? `LCP ${fmtSec(ps.field.lcpMs)}` : "",
        ps.field.inpMs ? `INP ${ps.field.inpMs}ms` : "",
        ps.field.cls !== undefined ? `CLS ${ps.field.cls.toFixed(2)}` : "",
      ].filter(Boolean);
      add({
        id: "perf-field",
        category: "performance",
        severity: "high",
        impact: 8,
        title: `Real visitors get a slow experience (${parts.join(", ")}) — fails Core Web Vitals`,
        hook: "real Chrome users are getting a 'poor' experience on your site according to Google's own data",
      });
    }
    if (ps.lab.cls !== undefined && ps.lab.cls > 0.25) {
      add({ id: "perf-cls", category: "performance", severity: "medium", title: `Layout shifts while loading (CLS ${ps.lab.cls.toFixed(2)})`, hook: "the page jumps around while it loads" });
    }
    if (ps.lab.tbtMs !== undefined && ps.lab.tbtMs > 600) {
      add({ id: "perf-tbt", category: "performance", severity: "medium", title: `Page is unresponsive for ${fmtSec(ps.lab.tbtMs)} while scripts run (TBT)` });
    }
    if (ps.totalBytes && ps.totalBytes > 4_000_000) {
      add({ id: "perf-weight", category: "performance", severity: "medium", title: `Homepage weighs ${fmtBytes(ps.totalBytes)}`, hook: `your homepage downloads ${fmtBytes(ps.totalBytes)} on every visit` });
    }
    for (const o of ps.opportunities.slice(0, 2)) {
      const savings = o.savingsMs ? ` — save ~${fmtSec(o.savingsMs)}` : o.savingsBytes ? ` — save ~${fmtBytes(o.savingsBytes)}` : "";
      add({ id: `perf-opp-${o.id}`, category: "performance", severity: "low", impact: Math.min(9, Math.round((o.savingsMs ?? 0) / 500)), title: `${o.title}${savings}` });
    }
  }

  // ── SEO ───────────────────────────────────────────────────────────────────
  const seo = r.seo;
  if (seo) {
    if (seo.robotsMeta && /noindex/i.test(seo.robotsMeta)) {
      add({ id: "seo-noindex", category: "seo", severity: "critical", title: "Homepage is set to noindex — invisible to Google", hook: "your homepage is telling Google not to index it" });
    }
    if (seo.robotsTxt?.disallowAll) {
      add({ id: "seo-robots-block", category: "seo", severity: "critical", title: "robots.txt blocks all crawlers", hook: "your robots.txt blocks search engines from the whole site" });
    }
    if (!seo.title) add({ id: "seo-title", category: "seo", severity: "high", title: "No <title> tag", hook: "your homepage has no page title in Google results" });
    else if (seo.titleLength > 65) add({ id: "seo-title-long", category: "seo", severity: "low", title: `Title is ${seo.titleLength} chars (gets truncated in Google)` });
    else if (seo.titleLength < 15) add({ id: "seo-title-short", category: "seo", severity: "low", title: `Title is only "${seo.title}"` });
    if (!seo.metaDescription) add({ id: "seo-desc", category: "seo", severity: "medium", title: "No meta description", hook: "Google is writing your search snippet for you because there's no meta description" });
    if (seo.h1.length === 0) add({ id: "seo-h1", category: "seo", severity: "medium", title: "No H1 heading on the homepage" });
    else if (seo.h1.length > 1) add({ id: "seo-h1-multi", category: "seo", severity: "low", impact: 2, title: `${seo.h1.length} H1 headings (should be one)` });
    if (!seo.viewport) add({ id: "seo-viewport", category: "seo", severity: "high", title: "No mobile viewport tag — not mobile-friendly", hook: "your site isn't set up for mobile screens" });
    if (!seo.og.title || !seo.og.image) {
      add({ id: "seo-og", category: "seo", severity: "medium", impact: 4, title: "Missing Open Graph tags — links shared on WhatsApp/LinkedIn show no preview", hook: "when someone shares your link on WhatsApp or LinkedIn, it shows up without a preview image" });
    }
    if (!seo.canonical) add({ id: "seo-canonical", category: "seo", severity: "low", impact: 3, title: "No canonical URL" });
    if (seo.images.total >= 3 && seo.images.missingAlt / seo.images.total > 0.3) {
      add({ id: "seo-alt", category: "seo", severity: "low", impact: 4, title: `${seo.images.missingAlt} of ${seo.images.total} images have no alt text` });
    }
    if (!seo.jsonLdTypes.length) add({ id: "seo-schema", category: "seo", severity: "medium", impact: 3, title: "No structured data (schema.org) — no rich results in Google" });
    if (seo.sitemap && !seo.sitemap.found) add({ id: "seo-sitemap", category: "seo", severity: "medium", impact: 3, title: "No sitemap.xml found" });
    if (seo.robotsTxt && !seo.robotsTxt.found) add({ id: "seo-robots", category: "seo", severity: "low", impact: 2, title: "No robots.txt" });
    if (seo.brokenLinks?.broken.length) {
      const n = seo.brokenLinks.broken.length;
      add({
        id: "seo-broken",
        category: "seo",
        severity: n >= 3 ? "high" : "medium",
        title: `${n} broken link${n > 1 ? "s" : ""} on the homepage (sampled ${seo.brokenLinks.checked})`,
        detail: seo.brokenLinks.broken.map((b) => `${b.url} → ${b.status}`).join("\n"),
        hook: `${n} link${n > 1 ? "s" : ""} on your homepage lead${n > 1 ? "" : "s"} to error pages`,
      });
    }
  }
  if (ps?.scores.seo !== null && ps?.scores.seo !== undefined && ps.scores.seo < 80 && !out.some((f) => f.category === "seo" && f.severity !== "low")) {
    add({ id: "seo-psi", category: "seo", severity: "medium", title: `Lighthouse SEO score ${ps.scores.seo}/100` });
  }

  // ── Security ──────────────────────────────────────────────────────────────
  const sec = r.security;
  if (sec) {
    if (sec.tlsError) add({ id: "sec-tls", category: "security", severity: "critical", title: `SSL/TLS problem: ${sec.tlsError}`, hook: "browsers are showing a security warning on your site" });
    if (!sec.https) add({ id: "sec-https", category: "security", severity: "critical", title: "Site is not served over HTTPS", hook: "visitors see 'Not secure' next to your address in Chrome" });
    else if (sec.httpRedirectsToHttps === false) add({ id: "sec-redirect", category: "security", severity: "high", title: "http:// doesn't redirect to https://" });
    if (sec.certificate?.daysLeft !== undefined && sec.certificate.daysLeft < 21) {
      add({
        id: "sec-cert",
        category: "security",
        severity: sec.certificate.daysLeft < 0 ? "critical" : "high",
        title: sec.certificate.daysLeft < 0 ? "SSL certificate has expired" : `SSL certificate expires in ${sec.certificate.daysLeft} days`,
        hook: `your SSL certificate expires in ${sec.certificate.daysLeft} days`,
      });
    }
    if (sec.mixedContent.length) {
      add({ id: "sec-mixed", category: "security", severity: "medium", title: `${sec.mixedContent.length} insecure (http://) resource${sec.mixedContent.length > 1 ? "s" : ""} on an https page`, detail: sec.mixedContent.join("\n") });
    }
    if (sec.exposedVersions.length) {
      add({ id: "sec-versions", category: "security", severity: "medium", impact: 4, title: `Exposes software versions: ${sec.exposedVersions.slice(0, 3).join(", ")}`, detail: sec.exposedVersions.join("\n") });
    }
    const missing = sec.missingHeaders;
    if (missing.includes("strict-transport-security") || missing.includes("content-security-policy")) {
      const pretty = missing.map((h) => ({ "strict-transport-security": "HSTS", "content-security-policy": "CSP", "x-frame-options": "X-Frame-Options", "x-content-type-options": "X-Content-Type-Options", "referrer-policy": "Referrer-Policy", "permissions-policy": "Permissions-Policy" })[h] ?? h);
      add({ id: "sec-headers", category: "security", severity: missing.length >= 4 ? "medium" : "low", impact: missing.length, title: `Missing security headers: ${pretty.join(", ")}` });
    }
    const grade = sec.observatory?.grade ?? sec.internalGrade;
    if (/^[DF]/.test(grade)) {
      add({ id: "sec-grade", category: "security", severity: "medium", impact: 6, title: `Security grade ${grade} (${sec.observatory ? "Mozilla Observatory" : "header check"})`, hook: `your site gets a ${grade} on Mozilla's security scan` });
    }
  }

  // ── Email deliverability ─────────────────────────────────────────────────
  const email = r.email;
  if (email) {
    if (!email.mx.length) {
      add({ id: "email-mx", category: "email", severity: "low", title: `No MX records — ${email.domain} can't receive email` });
    } else {
      if (!email.dmarc.record) {
        add({ id: "email-dmarc", category: "email", severity: "high", impact: 8, title: "No DMARC — emails may hit spam", hook: `emails from ${email.domain} are more likely to land in spam (and the domain is easier to spoof) because it has no DMARC record` });
      } else if (email.dmarc.policy === "none") {
        add({ id: "email-dmarc-none", category: "email", severity: "medium", impact: 4, title: "DMARC is monitor-only (p=none) — spoofing isn't blocked" });
      }
      if (!email.spf.record) {
        add({ id: "email-spf", category: "email", severity: "high", impact: 7, title: "No SPF record — emails may be rejected or marked as spam", hook: `mail servers can't verify emails from ${email.domain} because it has no SPF record` });
      } else if (email.spf.count > 1) {
        add({ id: "email-spf-multi", category: "email", severity: "high", title: `${email.spf.count} SPF records (only one is allowed — SPF fails)` });
      } else if (email.spf.allQualifier === "+") {
        add({ id: "email-spf-open", category: "email", severity: "critical", title: "SPF uses +all — anyone can send as this domain" });
      }
    }
  }

  // ── Automation opportunities ─────────────────────────────────────────────
  const auto = r.automation;
  if (auto && !r.fetch.blocked) {
    const noChat = !auto.liveChat.length && !auto.chatbot.length;
    const noBooking = !auto.booking.length;
    if (noChat && noBooking) {
      add({
        id: "auto-chat-booking",
        category: "automation",
        severity: "medium",
        impact: 7,
        title: `No booking or chat; ${auto.forms.count ? "contact form only" : "no contact form either"}`,
        hook: "visitors can't book a call or get an instant answer — they have to fill in a form and wait",
      });
    } else if (noChat) {
      add({ id: "auto-chat", category: "automation", severity: "medium", impact: 5, title: "No live chat or chatbot", hook: "there's no way to get an instant answer on your site" });
    } else if (noBooking) {
      add({ id: "auto-booking", category: "automation", severity: "low", impact: 6, title: "No online booking (Calendly-style)", hook: "visitors can't book a call or appointment online" });
    }
    if (auto.forms.count && !auto.forms.feedsCrm) {
      add({ id: "auto-crm", category: "automation", severity: "medium", impact: 5, title: "Contact form doesn't appear to feed a CRM (likely email-only)", hook: "your contact form looks like it just sends an email, so leads can slip through the cracks" });
    }
    if (!auto.whatsapp) {
      const big = auto.regionHint === "uae";
      add({ id: "auto-whatsapp", category: "automation", severity: big ? "medium" : "low", impact: big ? 7 : 3, title: "No WhatsApp button", hook: big ? "there's no WhatsApp button, which is how most UAE customers prefer to reach a business" : undefined });
    }
    if (!auto.newsletter.length && !auto.newsletterForm) {
      add({ id: "auto-newsletter", category: "automation", severity: "low", impact: 3, title: "No newsletter / email capture" });
    }
    if (!auto.analytics.length) {
      add({ id: "auto-analytics", category: "automation", severity: "medium", impact: 4, title: "No analytics detected", hook: "there's no analytics on the site, so you can't see where visitors come from" });
    }
    if (!auto.pixels.length) {
      add({ id: "auto-pixel", category: "automation", severity: "low", impact: 2, title: "No ad/retargeting pixel (Meta, Google Ads, LinkedIn)" });
    }
  }

  // ── Conversion, compliance & housekeeping ────────────────────────────────
  const ex = r.extras;
  if (ex && !r.fetch.blocked) {
    const tracking = (auto?.analytics.length ?? 0) + (auto?.pixels.length ?? 0) > 0;
    if (!ex.cookieConsent.length && tracking) {
      const strict = auto?.regionHint === "uk" || auto?.regionHint === "eu";
      add({
        id: "cmp-consent",
        category: "compliance",
        severity: strict ? "high" : "low",
        impact: strict ? 6 : 2,
        title: "Tracking runs without a cookie consent banner" + (strict ? " (UK/EU GDPR & PECR risk)" : ""),
        hook: strict ? "your site sets tracking cookies without a consent banner, which UK/EU rules require" : undefined,
      });
    }
    if (!ex.ctas.length) add({ id: "conv-cta", category: "conversion", severity: "medium", impact: 5, title: "No clear call-to-action on the homepage", hook: "the homepage doesn't have a clear next step for visitors" });
    if (!ex.testimonials.length) add({ id: "conv-proof", category: "conversion", severity: "low", impact: 4, title: "No testimonials or reviews on the site" });
    const year = new Date().getUTCFullYear();
    if (ex.copyrightYear && ex.copyrightYear <= year - 2) {
      add({ id: "conv-copyright", category: "conversion", severity: "low", impact: 5, title: `Footer says © ${ex.copyrightYear} — site looks unmaintained`, hook: `your footer still says © ${ex.copyrightYear}` });
    }
    if (ex.tapTargetsOk === false) add({ id: "conv-tap", category: "conversion", severity: "low", impact: 3, title: "Buttons/links are too small or too close together on mobile" });
    if (ex.domain?.ageYears !== undefined && ex.domain.ageYears < 1) {
      add({ id: "info-new-domain", category: "data", severity: "info", title: `Domain registered ${ex.domain.registered?.slice(0, 10)} (under a year old)` });
    }
  }

  if (r.contacts && !r.contacts.emails.length && !r.contacts.phones.length && !r.fetch.blocked) {
    add({ id: "conv-contact", category: "conversion", severity: "medium", impact: 5, title: "No email address or phone number found on the site" });
  }

  return out.sort((a, b) => findingWeight(b) - findingWeight(a));
}

/** Highest-weighted findings, at most one per category so the summary isn't all one topic. */
export function topFindings(findings: Finding[], n = 3): Finding[] {
  const picked: Finding[] = [];
  const cats = new Set<string>();
  for (const f of findings) {
    if (f.severity === "info" || cats.has(f.category)) continue;
    picked.push(f);
    cats.add(f.category);
    if (picked.length === n) return picked;
  }
  for (const f of findings) {
    if (picked.length === n) break;
    if (f.severity !== "info" && !picked.includes(f)) picked.push(f);
  }
  return picked;
}

export function computeScores(r: Pick<AnalysisResult, "pagespeed" | "seo" | "security" | "email">): Scores {
  const psi = r.pagespeed?.scores;
  const seoInternal = r.seo?.score ?? null;
  const seo = psi?.seo != null && seoInternal != null ? Math.round((psi.seo + seoInternal) / 2) : (seoInternal ?? psi?.seo ?? null);
  const security = r.security?.observatory
    ? { grade: r.security.observatory.grade, score: Math.min(100, r.security.observatory.score), source: "observatory" as const }
    : { grade: r.security?.internalGrade ?? gradeFor(0), score: r.security?.internalScore ?? 0, source: "internal" as const };
  const email = r.email?.score ?? 0;
  const parts: [number | null, number][] = [
    [psi?.performance ?? null, 0.3],
    [seo, 0.25],
    [r.security ? security.score : null, 0.2],
    [r.email ? email : null, 0.15],
    [psi?.bestPractices ?? null, 0.1],
  ];
  const present = parts.filter(([v]) => v !== null) as [number, number][];
  const totalWeight = present.reduce((s, [, w]) => s + w, 0);
  const overall = totalWeight ? Math.round(present.reduce((s, [v, w]) => s + v * w, 0) / totalWeight) : 0;
  return {
    performance: psi?.performance ?? null,
    seo,
    accessibility: psi?.accessibility ?? null,
    bestPractices: psi?.bestPractices ?? null,
    security,
    email,
    overall,
  };
}

/** Template hook used when no LLM is configured: built from the single worst finding with a hook. */
export function templateHook(findings: Finding[]): string | null {
  const f = findings.find((x) => x.hook);
  if (!f?.hook) return null;
  const text = f.hook.charAt(0).toUpperCase() + f.hook.slice(1);
  return `${text} — happy to show you how to fix it.`;
}

export function bestContact(r: Pick<AnalysisResult, "contacts">): { email?: string; phone?: string } {
  const c = r.contacts;
  return {
    email: c?.emails[0]?.value,
    phone: c?.phones[0] ? prettyPhone(c.phones[0].value) : undefined,
  };
}
