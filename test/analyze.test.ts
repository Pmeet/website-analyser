import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyze } from "../src/analyze";
import { fullReport, shortReport } from "../src/report";
import { DEFAULT_SETTINGS } from "../src/settings";
import type { Env } from "../src/types";
import { mockNetwork } from "./fixtures/site";

afterEach(() => vi.restoreAllMocks());

describe("analyze (end to end, mocked network)", () => {
  it("produces the outreach report", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return mockNetwork(url, init);
    });

    const result = await analyze(env as unknown as Env, "acme.co.uk", { settings: DEFAULT_SETTINGS });
    const report = shortReport(result);
    console.log(`\n${report}\n`);

    expect(result.checks.fetch.ok).toBe(true);
    expect(result.businessName).toBe("Acme Plumbing");
    expect(result.scores.performance).toBe(42);
    expect(result.scores.security.grade).toBe("D");
    expect(result.email?.dmarc.record).toBeNull();
    expect(result.email?.mxProvider).toBe("Google Workspace");
    expect(result.seo?.brokenLinks?.broken.map((b) => b.url)).toContain("https://acme.co.uk/old-page");
    expect(result.security?.exposedVersions.join(" ")).toMatch(/PHP\/7\.4\.3/);
    expect(result.security?.httpRedirectsToHttps).toBe(true);
    expect(result.contacts?.pagesScanned).toContain("https://acme.co.uk/contact-us/");
    expect(result.automation?.regionHint).toBe("uk");
    expect(result.automation?.forms.count).toBeGreaterThan(0);
    expect(result.automation?.forms.feedsCrm).toBe(false);
    expect(result.extras?.copyrightYear).toBe(2021);
    expect(result.extras?.domain?.registered).toContain("2009");

    const ids = result.findings.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(["perf-lcp", "email-dmarc", "auto-chat-booking", "auto-crm", "cmp-consent", "conv-copyright", "seo-desc"]));

    const lines = report.split("\n");
    expect(lines[0]).toBe("acme.co.uk — WordPress");
    expect(lines[1]).toMatch(/^Perf 42 \| SEO \d+ \| Security D \| Email no DMARC$/);
    expect(report).toContain("• LCP 5.8s on mobile (hero image 2.4MB)");
    expect(report).toContain("• No DMARC — emails may hit spam");
    expect(report).toMatch(/Contact: jane\.smith@acme\.co\.uk, \+44 20 7946 0958/);
    expect(report).toMatch(/^Hook: "Your homepage takes ~6s/m);

    const full = fullReport(result);
    expect(full).toContain("== Email deliverability ==");
    expect(full).toContain("Contact Form 7");
  });

  it("reports an unreachable site without throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    });
    const result = await analyze(env as unknown as Env, "https://does-not-exist.example", { settings: DEFAULT_SETTINGS, skipPagespeed: true });
    expect(result.fetch.error).toMatch(/ENOTFOUND/);
    expect(shortReport(result)).toContain("! Could not load the site");
  });
});
