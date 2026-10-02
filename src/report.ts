import type { AnalysisResult, Finding } from "./types";
import { PLATFORM_CATEGORIES } from "./stack/categories";
import { bestContact, fmtBytes, fmtSec, topFindings } from "./findings";
import { prettyPhone } from "./checks/contacts";

export function platformLabel(r: Pick<AnalysisResult, "stack">): string | null {
  for (const cat of PLATFORM_CATEGORIES) {
    const hits = r.stack.filter((t) => t.categories.includes(cat));
    if (hits.length) return hits.map((t) => t.name).slice(0, 2).join(" + ");
  }
  return null;
}

const val = (n: number | null | undefined) => (n === null || n === undefined ? "–" : String(n));

export function scoreLine(r: AnalysisResult): string {
  const s = r.scores;
  const email = r.email ? (r.email.dmarc.record && r.email.spf.record ? "OK" : `${[!r.email.spf.record && "no SPF", !r.email.dmarc.record && "no DMARC"].filter(Boolean).join(", ")}`) : "–";
  return `Perf ${val(s.performance)} | SEO ${val(s.seo)} | Security ${r.security ? s.security.grade : "–"} | Email ${email || "–"}`;
}

/** The short outreach-style summary from the spec. */
export function shortReport(r: AnalysisResult, bullets = 3): string {
  const platform = platformLabel(r);
  const lines = [`${r.host.replace(/^www\./, "")}${platform ? ` — ${platform}` : ""}`, scoreLine(r)];
  if (r.fetch.error) lines.push(`! Could not load the site: ${r.fetch.error}`);
  for (const f of topFindings(r.findings, bullets)) lines.push(`• ${f.title}`);
  const contact = bestContact(r);
  const contactParts = [contact.email, contact.phone].filter(Boolean);
  lines.push(`Contact: ${contactParts.length ? contactParts.join(", ") : "none found"}`);
  if (r.hook) lines.push(`Hook: "${r.hook.text}"`);
  return lines.join("\n");
}

function section(title: string, rows: (string | false | 0 | null | undefined)[]): string {
  const body = rows.filter(Boolean) as string[];
  return body.length ? `\n== ${title} ==\n${body.join("\n")}` : "";
}

function findingsBy(r: AnalysisResult, cat: Finding["category"]): string[] {
  return r.findings.filter((f) => f.category === cat).map((f) => `  [${f.severity}] ${f.title}`);
}

/** Full plain-text report with every section. */
export function fullReport(r: AnalysisResult): string {
  const out: string[] = [shortReport(r, 5)];
  const ps = r.pagespeed;
  const yes = (b: boolean) => (b ? "yes" : "no");
  out.push(
    section("Performance", [
      ps && `Lighthouse (${ps.strategy}): perf ${val(ps.scores.performance)}, SEO ${val(ps.scores.seo)}, accessibility ${val(ps.scores.accessibility)}, best practices ${val(ps.scores.bestPractices)}`,
      ps && `Lab: LCP ${ps.lab.lcpMs ? fmtSec(ps.lab.lcpMs) : "–"}, FCP ${ps.lab.fcpMs ? fmtSec(ps.lab.fcpMs) : "–"}, TBT ${ps.lab.tbtMs !== undefined ? `${Math.round(ps.lab.tbtMs)}ms` : "–"}, CLS ${ps.lab.cls?.toFixed(2) ?? "–"}${ps.totalBytes ? `, weight ${fmtBytes(ps.totalBytes)}` : ""}`,
      ps?.field.source && `Real users (${ps.field.source}): ${ps.field.overall ?? "?"} — LCP ${ps.field.lcpMs ? fmtSec(ps.field.lcpMs) : "–"}, INP ${ps.field.inpMs ?? "–"}ms, CLS ${ps.field.cls?.toFixed(2) ?? "–"}`,
      ps && !ps.field.source && "Real users: not enough Chrome traffic for field data",
      ps?.lcpElement?.label && `LCP element: ${ps.lcpElement.label}${ps.lcpElement.imageBytes ? ` (${fmtBytes(ps.lcpElement.imageBytes)})` : ""}`,
      ...(ps?.opportunities.slice(0, 6).map((o) => `  - ${o.title}${o.displayValue ? ` (${o.displayValue})` : ""}`) ?? []),
      !ps && `PageSpeed unavailable: ${r.checks.pagespeed?.error ?? r.checks.pagespeed?.skipped ?? "not run"}`,
    ]),
  );
  const seo = r.seo;
  out.push(
    section("SEO", [
      seo && `Title (${seo.titleLength}): ${seo.title ?? "—"}`,
      seo && `Meta description (${seo.metaDescriptionLength}): ${seo.metaDescription ?? "—"}`,
      seo && `H1: ${seo.h1.length ? seo.h1.slice(0, 3).map((h) => `"${h}"`).join(", ") : "none"}`,
      seo && `Canonical: ${seo.canonical ?? "none"} | lang: ${seo.lang ?? "none"} | OG: ${Object.keys(seo.og).length ? Object.keys(seo.og).join(", ") : "none"}`,
      seo && `Images: ${seo.images.total} (${seo.images.missingAlt} without alt) | Schema: ${seo.jsonLdTypes.join(", ") || "none"}`,
      seo?.robotsTxt && `robots.txt: ${seo.robotsTxt.found ? `found${seo.robotsTxt.disallowAll ? " (BLOCKS ALL)" : ""}` : "missing"} | sitemap: ${seo.sitemap?.found ? `${seo.sitemap.url} (${seo.sitemap.urlCount} URLs)` : "missing"}`,
      seo?.brokenLinks && `Links checked: ${seo.brokenLinks.checked}, broken: ${seo.brokenLinks.broken.length}`,
      ...findingsBy(r, "seo"),
    ]),
  );
  const sec = r.security;
  out.push(
    section("Security", [
      sec?.observatory && `Mozilla Observatory: ${sec.observatory.grade} (${sec.observatory.score}/100, ${sec.observatory.testsFailed} tests failed)`,
      sec && `Header check: ${sec.internalGrade} (${sec.internalScore}/100) | HTTPS: ${yes(sec.https)} | http→https redirect: ${sec.httpRedirectsToHttps === null ? "?" : yes(sec.httpRedirectsToHttps)}`,
      sec?.certificate && `Certificate: ${sec.certificate.issuer ?? "?"}, expires ${sec.certificate.notAfter?.slice(0, 10)} (${sec.certificate.daysLeft} days)`,
      ...findingsBy(r, "security"),
    ]),
  );
  const em = r.email;
  out.push(
    section("Email deliverability", [
      em && `MX: ${em.mx.length ? `${em.mx.slice(0, 2).join(", ")}${em.mxProvider ? ` (${em.mxProvider})` : ""}` : "none"}`,
      em && `SPF: ${em.spf.record ?? "missing"}`,
      em && `DMARC: ${em.dmarc.record ?? "missing"}`,
      em && `DKIM: ${em.dkim.selectorsFound.length ? `found (${em.dkim.selectorsFound.join(", ")})` : `not found on common selectors (${em.dkim.selectorsTried.join(", ")})`}`,
    ]),
  );
  out.push(section("Tech stack", r.stack.map((t) => `  ${t.name}${t.version ? ` ${t.version}` : ""} — ${t.categories.join(", ")}`)));
  const a = r.automation;
  out.push(
    section("Automation", [
      a && `Live chat: ${a.liveChat.join(", ") || "none"} | Chatbot: ${a.chatbot.join(", ") || "none"}`,
      a && `Booking: ${a.booking.join(", ") || "none"} | CRM: ${a.crm.join(", ") || "none"}`,
      a && `Contact forms: ${a.forms.count}${a.forms.handlers.length ? ` via ${a.forms.handlers.join(", ")}` : ""} | feeds CRM: ${yes(a.forms.feedsCrm)}`,
      a && `WhatsApp: ${yes(a.whatsapp)} | Newsletter: ${a.newsletter.join(", ") || (a.newsletterForm ? "form found" : "none")}`,
      a && `Analytics: ${a.analytics.join(", ") || "none"} | Pixels: ${a.pixels.join(", ") || "none"} | Region: ${a.regionHint}`,
      ...findingsBy(r, "automation"),
    ]),
  );
  const ex = r.extras;
  out.push(
    section("Conversion & compliance", [
      ex && `CTAs: ${ex.ctas.join(" · ") || "none found"}`,
      ex && `Social proof: ${ex.testimonials.join(", ") || "none found"}`,
      ex && `Cookie consent: ${ex.cookieConsent.join(", ") || "none"} | © year: ${ex.copyrightYear ?? "?"} | viewport: ${yes(ex.viewportOk)}`,
      ex?.domain?.registered && `Domain registered: ${ex.domain.registered.slice(0, 10)} (${ex.domain.ageYears} yrs)${ex.domain.registrar ? ` via ${ex.domain.registrar}` : ""}`,
      ...findingsBy(r, "conversion"),
      ...findingsBy(r, "compliance"),
    ]),
  );
  const c = r.contacts;
  out.push(
    section("Contacts", [
      c?.emails.length && `Emails: ${c.emails.map((e) => `${e.value}${e.generic ? " (generic)" : ""}`).join(", ")}`,
      c?.phones.length && `Phones: ${c.phones.map((p) => prettyPhone(p.value)).join(", ")}`,
      c?.whatsapp.length && `WhatsApp: ${c.whatsapp.join(", ")}`,
      c && Object.keys(c.socials).length > 0 && `Social: ${Object.values(c.socials).join(", ")}`,
      c?.organization?.address && `Address: ${c.organization.address}`,
      c && `Pages scanned: ${c.pagesScanned.join(", ")}`,
    ]),
  );
  const failed = Object.entries(r.checks).filter(([, s]) => !s.ok || s.skipped);
  out.push(section("Checks that failed or were skipped", failed.map(([k, s]) => `  ${k}: ${s.error ?? s.skipped}`)));
  out.push(`\nAnalysed ${r.analyzedAt} in ${fmtSec(r.durationMs)}`);
  return out.join("\n");
}
