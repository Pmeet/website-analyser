/** A typical small-business WordPress homepage with a few common problems. */
export const HOME_HTML = `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <title>Acme Plumbing | Emergency Plumbers in London</title>
  <meta name="generator" content="WordPress 6.2.1">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta property="og:site_name" content="Acme Plumbing">
  <link rel="stylesheet" href="https://acme.co.uk/wp-content/plugins/elementor/assets/css/frontend.min.css?ver=3.12.2">
  <script src="https://acme.co.uk/wp-content/plugins/contact-form-7/includes/js/index.js?ver=5.7.4"></script>
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"></script>
  <script>window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments);} gtag('config', 'G-ABC123');</script>
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Plumber","name":"Acme Plumbing Ltd","telephone":"+44 20 7946 0958","address":{"@type":"PostalAddress","streetAddress":"1 High St","addressLocality":"London","postalCode":"E1 1AA"},"sameAs":["https://www.facebook.com/acmeplumbing"]}</script>
</head>
<body class="elementor-page">
  <header><nav>
    <a href="/">Home</a>
    <a href="/services/">Services</a>
    <a href="/contact-us/">Contact</a>
    <a href="/about/">About us</a>
  </nav></header>
  <h1>Fast, friendly plumbers</h1>
  <h1>Available 24/7</h1>
  <img src="/hero.jpg">
  <img src="/van.jpg" alt="Our van">
  <img src="/team.jpg">
  <a href="tel:+442079460958">Call 020 7946 0958</a>
  <a href="mailto:hello@acme.co.uk">hello@acme.co.uk</a>
  <a class="button" href="/quote/">Get a free quote</a>
  <p>Contact sales@example.com or icon@2x.png for nothing.</p>
  <a href="https://www.linkedin.com/company/acme-plumbing/">LinkedIn</a>
  <a href="https://acme.co.uk/old-page">Old page</a>
  <form class="wpcf7-form" action="/contact-us/#wpcf7-f1" method="post">
    <input type="text" name="your-name"><input type="email" name="your-email">
    <textarea name="your-message"></textarea><input type="submit" value="Send">
  </form>
  <footer>&copy; 2021 Acme Plumbing Ltd. All rights reserved.</footer>
</body>
</html>`;

export const CONTACT_HTML = `<!DOCTYPE html><html><head><title>Contact</title></head><body>
<h1>Contact us</h1><p>Email jane.smith@acme.co.uk or call +44 20 7946 0000.</p>
</body></html>`;

export const PSI_JSON = {
  loadingExperience: { origin_fallback: true },
  originLoadingExperience: {},
  lighthouseResult: {
    categories: {
      performance: { score: 0.42, auditRefs: [{ id: "largest-contentful-paint", weight: 25 }, { id: "uses-optimized-images", weight: 0 }, { id: "render-blocking-resources", weight: 0 }] },
      seo: { score: 0.78, auditRefs: [{ id: "meta-description", weight: 1 }] },
      accessibility: { score: 0.81, auditRefs: [{ id: "target-size", weight: 7 }] },
      "best-practices": { score: 0.74, auditRefs: [] },
    },
    audits: {
      "largest-contentful-paint": { id: "largest-contentful-paint", title: "LCP", score: 0.1, numericValue: 5800, scoreDisplayMode: "numeric" },
      "first-contentful-paint": { id: "first-contentful-paint", title: "FCP", score: 0.5, numericValue: 2100 },
      "cumulative-layout-shift": { id: "cumulative-layout-shift", title: "CLS", score: 0.9, numericValue: 0.05 },
      "total-blocking-time": { id: "total-blocking-time", title: "TBT", score: 0.6, numericValue: 320 },
      "total-byte-weight": { id: "total-byte-weight", title: "Weight", score: 0.5, numericValue: 3_900_000 },
      "uses-optimized-images": { id: "uses-optimized-images", title: "Efficiently encode images", score: 0.2, scoreDisplayMode: "metricSavings", displayValue: "Potential savings of 1,900 KiB", details: { overallSavingsMs: 2400, overallSavingsBytes: 1_950_000 } },
      "render-blocking-resources": { id: "render-blocking-resources", title: "Eliminate render-blocking resources", score: 0.5, scoreDisplayMode: "metricSavings", details: { overallSavingsMs: 600 } },
      "largest-contentful-paint-element": {
        id: "largest-contentful-paint-element",
        title: "LCP element",
        score: null,
        details: { type: "list", items: [{ type: "table", items: [{ node: { type: "node", snippet: '<img src="https://acme.co.uk/hero.jpg">', nodeLabel: "Hero image" } }] }] },
      },
      "network-requests": { id: "network-requests", title: "Network", score: null, details: { items: [{ url: "https://acme.co.uk/hero.jpg", transferSize: 2_400_000, resourceSize: 2_400_000 }] } },
      "meta-description": { id: "meta-description", title: "Document does not have a meta description", score: 0, scoreDisplayMode: "binary" },
      "target-size": { id: "target-size", title: "Touch targets do not have sufficient size or spacing.", score: 0, scoreDisplayMode: "binary" },
    },
  },
};

const doh = (answers: { name: string; type: number; data: string }[]) => ({ Status: 0, Answer: answers.map((a) => ({ ...a, TTL: 300 })) });

/** Routes every outbound request the analyser makes to canned responses. */
export function mockNetwork(url: string, init?: RequestInit): Response {
  const u = new URL(url);
  const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", server: "Apache/2.4.41 (Ubuntu)", "x-powered-by": "PHP/7.4.3" } });
  const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  if (u.hostname === "www.googleapis.com") return jsonRes(PSI_JSON);
  if (u.hostname === "cloudflare-dns.com") {
    const name = u.searchParams.get("name");
    const type = u.searchParams.get("type");
    if (name === "acme.co.uk" && type === "MX") return jsonRes(doh([{ name, type: 15, data: "1 aspmx.l.google.com." }]));
    if (name === "acme.co.uk" && type === "TXT") return jsonRes(doh([{ name, type: 16, data: '"v=spf1 include:_spf.google.com" " ~all"' }]));
    return jsonRes({ Status: 3 });
  }
  if (u.hostname === "observatory-api.mdn.mozilla.net") return jsonRes({ grade: "D", score: 30, tests_failed: 5, tests_passed: 5, details_url: "https://developer.mozilla.org/en-US/observatory/analyze?host=acme.co.uk" });
  if (u.hostname === "crt.sh") {
    const soon = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 19);
    return jsonRes([{ name_value: "acme.co.uk\nwww.acme.co.uk", not_before: "2026-07-01T00:00:00", not_after: soon, issuer_name: 'C=US, O="Let\'s Encrypt", CN=R11' }]);
  }
  if (u.hostname === "rdap.org") return jsonRes({ events: [{ eventAction: "registration", eventDate: "2009-03-01T00:00:00Z" }], entities: [] });
  if (u.hostname === "acme.co.uk" || u.hostname === "www.acme.co.uk") {
    if (u.protocol === "http:" && init?.redirect === "manual") return new Response(null, { status: 301, headers: { location: "https://acme.co.uk/" } });
    if (u.pathname === "/") return html(HOME_HTML);
    if (u.pathname === "/contact-us/") return html(CONTACT_HTML);
    if (u.pathname === "/robots.txt") return new Response("User-agent: *\nDisallow: /wp-admin/\n", { headers: { "content-type": "text/plain" } });
    if (u.pathname === "/old-page") return html("gone", 404);
    return html("<html><body>ok</body></html>");
  }
  return new Response("ok");
}
