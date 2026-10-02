# Website Analyser

A Cloudflare Worker that audits a business website and writes a short plain-text report you can use for outreach. It covers performance, SEO, security, email deliverability, tech stack, missing automations, conversion basics and contact details. An LLM can optionally write the opening line, using an API key from any provider.

```
acme.co.uk — WordPress
Perf 42 | SEO 68 | Security D | Email no DMARC
• LCP 5.8s on mobile (hero image 2.4MB)
• No DMARC — emails may hit spam
• Tracking runs without a cookie consent banner (UK/EU GDPR & PECR risk)
Contact: jane.smith@acme.co.uk, +44 20 7946 0958
Hook: "Your homepage takes ~6s to show its main content on mobile, mostly because of a 2.4MB hero image — happy to show you how to fix it."
```

It has a web UI (Analyse, Batch and Settings tabs), a JSON/text API, and batch mode. In batch mode you paste up to 200 URLs, a Queue processes them, D1 stores the results, and you export CSV, TXT or JSON.

## What it checks

| Area | Source | What you get |
|---|---|---|
| Performance, a11y, best practices | Google PageSpeed Insights API | Lighthouse scores, LCP/FCP/TBT/CLS, real-user Core Web Vitals (when Chrome has data), LCP element + image weight, top savings opportunities |
| On-page SEO | Own HTMLRewriter parse | Title/description length, H1s, canonical, `lang`, viewport, OG/Twitter tags, image alt text, JSON-LD types, `noindex`, robots.txt, sitemap.xml, sampled broken links |
| Security | Response headers, crt.sh, Mozilla HTTP Observatory | HSTS/CSP/XFO/etc., http→https redirect, TLS failure, cert expiry, mixed content, leaked versions (generator, `X-Powered-By`, `Server`, WordPress plugin `?ver=`), Observatory grade |
| Email | Cloudflare DNS-over-HTTPS | MX + provider, SPF (missing / multiple / `+all`), DMARC (missing / `p=none`), DKIM on common selectors |
| Tech stack | Built-in fingerprints + optional webappanalyzer dataset | CMS, page builders, ecommerce, analytics, pixels, chat, booking, CRM, forms, consent tools, reviews |
| Automation gaps | Stack + page signals | No chat/chatbot, no booking, contact form not feeding a CRM, no WhatsApp button (weighted up for UAE sites), no newsletter capture, no analytics, no pixel |
| Contacts | Homepage + discovered contact/about pages | mailto/tel links, emails/phones in text, WhatsApp numbers, social profiles, schema.org business data (generic `info@` addresses ranked last) |
| Extras | Page signals, RDAP | Cookie consent (stricter for UK/EU), CTAs, testimonials/reviews, stale © year, mobile tap targets, domain age |

Each check runs on its own. If one fails or times out, the report still comes out and the failure is listed under "Checks that failed or were skipped".

## Setup

You need Node 20+ and a Cloudflare account.

```bash
npm install

# 1. Database (paste the printed database_id into wrangler.toml)
npx wrangler d1 create website-analyser
npm run db:migrate:remote

# 2. Queue for batches
npx wrangler queues create website-analyser-jobs

# 3. Secrets
npx wrangler secret put ACCESS_TOKEN        # protects the UI/API: strongly recommended
npx wrangler secret put PAGESPEED_API_KEY   # optional, can also be set in the Settings tab

# 4. Deploy
npm run deploy
```

Get a free PageSpeed key from Google Cloud: create a project, enable "PageSpeed Insights API", then create an API key. Without a key, Google's shared quota runs out almost immediately.

### Local development

```bash
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev            # http://localhost:8787
npm test               # vitest inside the Workers runtime (network is mocked)
npm run typecheck
```

## Optional extras

**AI hook.** Open Settings → AI outreach hook and choose a provider:

- **Anthropic (Claude).** Uses the official SDK. If you leave the model blank it uses `claude-opus-5-5`. Set `claude-haiku-4-5` for the cheapest option.
- **OpenAI-compatible.** Presets cover OpenAI, Google Gemini, Groq, OpenRouter, Mistral, DeepSeek, Together and xAI, or you can enter any custom base URL. Model names change often, so check your provider's current list.
- **Workers AI.** Free tier. Uncomment the `[ai]` binding in `wrangler.toml`.

Add a line about yourself and your offer so the hook fits what you sell. Without an LLM, the hook is a template built from the worst finding.

**Browser Rendering.** Some sites render everything with JavaScript or block plain scrapers. Set `CF_ACCOUNT_ID` and `CF_API_TOKEN` (the token needs the *Browser Rendering – Edit* permission). Those sites are then re-fetched through Cloudflare Browser Rendering.

**Full fingerprint dataset.** The built-in rules (`src/stack/rules.ts`) cover about 160 technologies that matter for the report. To detect thousands more, run:

```bash
npm run fingerprints   # downloads enthec/webappanalyzer → src/stack/fingerprints.generated.json
```

Two caveats:
- That dataset is **GPL-3.0**, while this project is Apache-2.0. Decide whether you want it in your deployment before committing the generated file.
- It also costs more CPU: about 20ms per page instead of about 10ms.

## API

All `/api/*` routes need `Authorization: Bearer <ACCESS_TOKEN>` when the secret is set (or `?token=` for download links).

```bash
# Short report as plain text
curl -H "Authorization: Bearer $TOKEN" "https://<worker>/api/analyze?url=acme.co.uk&format=text"

# Full report: format=full. Everything as JSON: omit format, or POST:
curl -X POST -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"url":"acme.co.uk","skipPagespeed":false,"skipAi":false}' https://<worker>/api/analyze

# Batches
curl -X POST ... -d '{"name":"Dubai clinics","urls":"a.ae\nb.ae\nc.ae"}' https://<worker>/api/batches
curl ... https://<worker>/api/batches/<id>                 # progress + rows
curl ... "https://<worker>/api/batches/<id>/export?format=csv"   # csv | txt | json
```

Other routes: `GET/PUT /api/settings`, `POST /api/settings/test-ai`, `POST /api/batches/<id>/retry`, `DELETE /api/batches/<id>`, `GET /api/health`.

## Limits and gotchas

- **Workers plan.** On the free plan, a request gets 10ms of CPU and 50 subrequests:
  - HTML parsing plus fingerprinting can exceed 10ms on large pages, and one analysis makes roughly 30–45 subrequests.
  - The paid plan ($5/mo) removes both problems. On the free plan, lower the broken-link sample and skip the full fingerprint dataset.
- **PageSpeed is slow.** It takes 10–30s. Every other check runs in parallel with it. Batch items each run in their own queue invocation.
- **Some sites block scrapers** (Cloudflare challenges, DataDome and similar). These are flagged and on-page checks are skipped. Browser Rendering helps with some of them.
- **Contact details** often come back empty or only as a generic `info@` address.
- **crt.sh and the Observatory** are free community services and sometimes time out or rate-limit. The report notes when that happens. The certificate check reports the newest certificate logged for the host, which is usually the one being served.
- **Compliance.** Cold email to UK/EU businesses falls under PECR and GDPR. Contact business addresses only, say why you're getting in touch, and include an opt-out.

## Project layout

```
src/
  index.ts            router, auth, queue consumer
  analyze.ts          orchestrates every check (slow lookups start first, in parallel)
  checks/             fetchPage, html (HTMLRewriter), pagespeed, dns, security, seo, contacts, automation
  stack/              fingerprint engine (Wappalyzer pattern syntax), built-in rules, categories
  findings.ts         findings, severities, scores, template hook
  report.ts           short + full plain-text reports
  ai.ts               Anthropic / OpenAI-compatible / Workers AI providers
  settings.ts         settings in D1 (secrets masked in the UI)
  batch.ts            batches, items, exports
public/               UI (vanilla JS, no build step)
migrations/           D1 schema
scripts/              update-fingerprints.mjs
test/                 vitest (Workers runtime) with a mocked network
```
