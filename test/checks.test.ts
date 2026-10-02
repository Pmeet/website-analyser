import { describe, expect, it } from "vitest";
import { extractPage, visibleText } from "../src/checks/html";
import { detectStack, parsePattern, resolveVersion } from "../src/stack/detect";
import { extractContacts, normalizePhone } from "../src/checks/contacts";
import { parseRobots } from "../src/checks/seo";
import { joinTxt, scoreEmail } from "../src/checks/dns";
import { parsePageSpeed } from "../src/checks/pagespeed";
import { copyrightYear } from "../src/checks/automation";
import { gradeFor, inspectHeaders } from "../src/checks/security";
import { parseUrlList } from "../src/batch";
import { CONTACT_HTML, HOME_HTML, PSI_JSON } from "./fixtures/site";

describe("extractPage", () => {
  it("pulls the structured fields out of a document", async () => {
    const page = await extractPage(HOME_HTML, "https://acme.co.uk/");
    expect(page.title).toBe("Acme Plumbing | Emergency Plumbers in London");
    expect(page.lang).toBe("en-GB");
    expect(page.headings.h1).toEqual(["Fast, friendly plumbers", "Available 24/7"]);
    expect(page.images.filter((i) => i.alt === null)).toHaveLength(2);
    expect(page.anchors.find((a) => a.href.startsWith("tel:"))?.text).toBe("Call 020 7946 0958");
    expect(page.forms[0].inputs.map((i) => i.type)).toEqual(["text", "email", "textarea", "submit"]);
    expect(page.jsonLd).toHaveLength(1);
    expect(page.buttons).toContain("Send");
    expect(page.text).toContain("© 2021 Acme Plumbing");
    expect(page.text).not.toContain("dataLayer");
  });

  it("strips scripts and styles from visible text", () => {
    expect(visibleText("<p>Hi &amp; bye</p><script>var x=1</script><style>.a{}</style>")).toBe("Hi & bye");
  });
});

describe("stack detection", () => {
  it("parses Wappalyzer-style patterns and versions", () => {
    const p = parsePattern("WordPress ([\\d.]+)\\;version:\\1\\;confidence:50");
    expect(p?.confidence).toBe(50);
    const m = "WordPress 6.2.1".match(p!.re)!;
    expect(resolveVersion(p!.version, m)).toBe("6.2.1");
    expect(resolveVersion("\\1?new:old", ["x", ""] as unknown as RegExpMatchArray)).toBe("old");
  });

  it("detects the platform, plugins and analytics", async () => {
    const page = await extractPage(HOME_HTML, "https://acme.co.uk/");
    const stack = await detectStack({ page, fetched: { headers: { server: "Apache/2.4.41" }, setCookies: [], finalUrl: "https://acme.co.uk/" } });
    const names = stack.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["WordPress", "Elementor", "Contact Form 7", "Google Analytics", "Apache HTTP Server"]));
    expect(stack.find((t) => t.name === "WordPress")?.version).toBe("6.2.1");
    expect(names).not.toContain("Shopify");
  });
});

describe("contacts", () => {
  it("collects emails, phones and socials and drops junk", async () => {
    const pages = [await extractPage(HOME_HTML, "https://acme.co.uk/"), await extractPage(CONTACT_HTML, "https://acme.co.uk/contact-us/")];
    const c = extractContacts(pages, "https://acme.co.uk/");
    const emails = c.emails.map((e) => e.value);
    expect(emails[0]).toBe("jane.smith@acme.co.uk"); // personal + same domain ranks first
    expect(emails).toContain("hello@acme.co.uk");
    expect(emails).not.toContain("sales@example.com");
    expect(emails.some((e) => e.includes("2x.png"))).toBe(false);
    expect(c.phones.map((p) => p.value)).toEqual(expect.arrayContaining(["+442079460958", "+442079460000"]));
    expect(c.socials.linkedin).toContain("linkedin.com/company/acme-plumbing");
    expect(c.socials.facebook).toContain("facebook.com/acmeplumbing");
    expect(c.organization?.name).toBe("Acme Plumbing Ltd");
  });

  it("normalises phone numbers", () => {
    expect(normalizePhone("tel:+44 (0)20-7946 0958")).toBe("+4402079460958");
    expect(normalizePhone("tel:00971 4 123 4567")).toBe("+97141234567");
    expect(normalizePhone("tel:123")).toBeNull();
  });
});

describe("small parsers", () => {
  it("robots.txt", () => {
    expect(parseRobots("User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin\nSitemap: https://x.com/s.xml")).toEqual({
      disallowAll: false,
      sitemaps: ["https://x.com/s.xml"],
    });
    expect(parseRobots("User-agent: *\nDisallow: /").disallowAll).toBe(true);
  });

  it("joins split TXT records", () => {
    expect(joinTxt('"v=spf1 include:a" " -all"')).toBe("v=spf1 include:a -all");
  });

  it("scores email auth", () => {
    const base = { domain: "x.com", mx: ["mx.x.com"], mxProvider: null, dkim: { selectorsFound: [], selectorsTried: [] }, score: 0 };
    expect(scoreEmail({ ...base, spf: { record: null, count: 0, allQualifier: null }, dmarc: { record: null, policy: null, rua: false } })).toBe(0);
    expect(scoreEmail({ ...base, spf: { record: "v=spf1 -all", count: 1, allQualifier: "-" }, dmarc: { record: "v=DMARC1; p=reject", policy: "reject", rua: true }, dkim: { selectorsFound: ["google"], selectorsTried: [] } })).toBe(100);
  });

  it("PageSpeed response", () => {
    const ps = parsePageSpeed(PSI_JSON, "mobile");
    expect(ps.scores).toEqual({ performance: 42, seo: 78, accessibility: 81, bestPractices: 74 });
    expect(ps.lab.lcpMs).toBe(5800);
    expect(ps.lcpElement?.imageBytes).toBe(2_400_000);
    expect(ps.opportunities[0].id).toBe("uses-optimized-images");
    expect(ps.failedAudits.map((a) => a.id)).toEqual(expect.arrayContaining(["meta-description", "target-size"]));
    expect(ps.field.source).toBeNull();
  });

  it("copyright year", () => {
    expect(copyrightYear("Copyright © 2015 – 2019 Acme")).toBe(2019);
    expect(copyrightYear("no year here")).toBeNull();
  });

  it("security headers and grades", () => {
    const { missing } = inspectHeaders({ "content-security-policy": "frame-ancestors 'self'" });
    expect(missing).not.toContain("x-frame-options");
    expect(missing).toContain("strict-transport-security");
    expect(gradeFor(30)).toBe("D");
    expect(gradeFor(100)).toBe("A+");
  });

  it("URL lists for batches", () => {
    const { urls, invalid } = parseUrlList("acme.co.uk\nhttps://www.acme.co.uk/\nfoo, example.com  nodot");
    expect(urls).toEqual(["https://acme.co.uk/", "https://example.com/"]);
    expect(invalid).toEqual(["foo", "nodot"]);
  });
});
