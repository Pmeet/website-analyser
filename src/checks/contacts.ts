import type { ContactResult, PageData } from "../types";
import { hostOf, registrableDomain, resolveUrl } from "../lib/http";
import { jsonLdNodes } from "./html";

const GENERIC_PREFIXES = /^(info|hello|hi|contact|contactus|enquiries|enquiry|inquiries|sales|admin|office|support|help|team|mail|reception|bookings?|accounts|hr|careers|jobs|marketing|press|media|studio|general|service|customerservice|care)$/i;

const JUNK_EMAIL = [
  /\.(png|jpe?g|gif|webp|svg|avif|css|js)$/i,
  /@(example|domain|email|yourdomain|yoursite|company|test|sentry|sentry-next|wixpress|mysite)\./i,
  /@sentry\.io$/i,
  /^(name|your\.?name|user|username|email|john\.?doe|jane\.?doe)@/i,
  /u00[0-9a-f]{2}/i,
];

const SOCIAL_PATTERNS: [string, RegExp][] = [
  ["linkedin", /linkedin\.com\/(company|in|school)\/[^/?#]+/i],
  ["facebook", /facebook\.com\/(?!sharer|share|dialog|plugins|tr\b)[^/?#]+/i],
  ["instagram", /instagram\.com\/(?!p\/|explore)[^/?#]+/i],
  ["x", /(?:twitter|x)\.com\/(?!intent|share|home)[^/?#]+/i],
  ["youtube", /youtube\.com\/(@[^/?#]+|channel\/[^/?#]+|c\/[^/?#]+|user\/[^/?#]+)/i],
  ["tiktok", /tiktok\.com\/@[^/?#]+/i],
  ["pinterest", /pinterest\.[a-z.]+\/(?!pin\/)[^/?#]+/i],
];

const CONTACT_LINK = /contact|get-in-touch|getintouch|enquir|reach-us|kontakt|contacto|اتصل/i;
const ABOUT_LINK = /about|our-story|who-we-are|team|impressum/i;

/** Finds the contact/about pages linked from the homepage (same host), with sensible fallbacks. */
export function discoverContactPages(page: PageData, baseUrl: string, max = 2): string[] {
  const host = hostOf(baseUrl);
  const found: { url: string; rank: number }[] = [];
  for (const a of page.anchors) {
    const abs = resolveUrl(a.href, baseUrl);
    if (!abs || !/^https?:/.test(abs)) continue;
    let u: URL;
    try {
      u = new URL(abs);
    } catch {
      continue;
    }
    if (u.hostname !== host || u.pathname === "/" || /\.(pdf|jpe?g|png|zip)$/i.test(u.pathname)) continue;
    const hay = `${u.pathname} ${a.text}`;
    const rank = CONTACT_LINK.test(hay) ? 0 : ABOUT_LINK.test(hay) ? 1 : -1;
    if (rank >= 0) found.push({ url: `${u.origin}${u.pathname}`, rank });
  }
  found.sort((a, b) => a.rank - b.rank);
  const urls = [...new Set(found.map((f) => f.url))];
  const origin = new URL(baseUrl).origin;
  if (!found.some((f) => f.rank === 0)) urls.unshift(`${origin}/contact`);
  if (!found.some((f) => f.rank === 1)) urls.push(`${origin}/about`);
  return [...new Set(urls)].slice(0, max);
}

export function normalizePhone(raw: string): string | null {
  const cleaned = decodeURIComponent(raw).replace(/^tel:/i, "").replace(/[^\d+]/g, "");
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return cleaned.startsWith("+") ? `+${digits}` : digits.startsWith("00") ? `+${digits.slice(2)}` : digits;
}

export function prettyPhone(p: string): string {
  // Light formatting for the regions this tool targets most; otherwise leave as-is.
  let m = p.match(/^\+44(\d{10})$/);
  if (m) {
    const n = m[1];
    if (/^(20|23|24|28|29)/.test(n)) return `+44 ${n.slice(0, 2)} ${n.slice(2, 6)} ${n.slice(6)}`;
    return `+44 ${n.slice(0, 4)} ${n.slice(4)}`;
  }
  m = p.match(/^\+971(\d{8,9})$/);
  if (m) {
    const n = m[1];
    const area = n.startsWith("5") ? n.slice(0, 2) : n.slice(0, 1);
    const rest = n.slice(area.length);
    return `+971 ${area} ${rest.slice(0, 3)} ${rest.slice(3)}`;
  }
  return p;
}

export function extractContacts(pages: PageData[], siteUrl: string): ContactResult {
  const siteDomain = registrableDomain(siteUrl);
  const emails = new Map<string, ContactResult["emails"][number]>();
  const phones = new Map<string, ContactResult["phones"][number]>();
  const whatsapp = new Set<string>();
  const socials: Record<string, string> = {};
  let organization: ContactResult["organization"] = null;

  const addEmail = (raw: string, source: string) => {
    const value = decodeURIComponent(raw).replace(/^mailto:/i, "").split("?")[0].trim().toLowerCase();
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(value) || JUNK_EMAIL.some((re) => re.test(value))) return;
    if (emails.has(value)) return;
    const [local, domain] = value.split("@");
    emails.set(value, { value, generic: GENERIC_PREFIXES.test(local), sameDomain: registrableDomain(domain) === siteDomain, source });
  };
  const addPhone = (raw: string, source: string) => {
    const value = normalizePhone(raw);
    if (value && !phones.has(value)) phones.set(value, { value, source });
  };

  for (const page of pages) {
    const path = new URL(page.url).pathname || "/";
    for (const a of page.anchors) {
      const href = a.href;
      if (/^mailto:/i.test(href)) addEmail(href, `${path} mailto`);
      else if (/^(tel|callto):/i.test(href)) addPhone(href.replace(/^callto:/i, "tel:"), `${path} tel link`);
      else if (/wa\.me\/|api\.whatsapp\.com\/send|whatsapp:\/\/send|web\.whatsapp\.com\/send/i.test(href)) {
        const num = href.match(/wa\.me\/\+?(\d{7,15})/i)?.[1] ?? href.match(/phone=\+?(\d{7,15})/i)?.[1];
        whatsapp.add(num ? `+${num}` : href);
      } else {
        for (const [network, re] of SOCIAL_PATTERNS) {
          if (!socials[network] && re.test(href)) socials[network] = href.split("?")[0];
        }
      }
    }

    // Emails in visible text and raw HTML (e.g. obfuscated only by markup).
    for (const m of page.text.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) addEmail(m[0], `${path} text`);
    for (const m of page.html.matchAll(/[a-z0-9._%+-]+(?:@|&#64;|&#x40;)[a-z0-9.-]+\.[a-z]{2,}/gi)) {
      addEmail(m[0].replace(/&#64;|&#x40;/i, "@"), `${path} html`);
    }
    // Phones in visible text: international (+44 …) format only, to avoid matching random numbers.
    for (const m of page.text.matchAll(/(?<![\w+])\+\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}(?!\d)/g)) addPhone(m[0], `${path} text`);

    for (const node of jsonLdNodes(page)) {
      // Any schema.org business type (Organization, LocalBusiness, Plumber, Dentist, …) carries these fields.
      const type = JSON.stringify(node["@type"] ?? "");
      if (/WebPage|WebSite|Breadcrumb|ImageObject|Article|BlogPosting|Product|Offer|FAQ|Person|SearchAction/i.test(type)) continue;
      if (typeof node.name !== "string" || !(node.telephone || node.address || node.sameAs || node.email || node.logo)) continue;
      const str = (v: unknown) => (typeof v === "string" ? v : undefined);
      const address = node.address as Record<string, unknown> | string | undefined;
      const addressText =
        typeof address === "string"
          ? address
          : address
            ? [address.streetAddress, address.addressLocality, address.postalCode, address.addressCountry].filter((x) => typeof x === "string").join(", ")
            : undefined;
      organization ??= {
        name: str(node.name),
        telephone: str(node.telephone),
        email: str(node.email)?.replace(/^mailto:/i, ""),
        address: addressText || undefined,
      };
      if (str(node.telephone)) addPhone(node.telephone as string, `${path} schema.org`);
      if (str(node.email)) addEmail(node.email as string, `${path} schema.org`);
      const sameAs = Array.isArray(node.sameAs) ? node.sameAs : node.sameAs ? [node.sameAs] : [];
      for (const s of sameAs) {
        if (typeof s !== "string") continue;
        for (const [network, re] of SOCIAL_PATTERNS) if (!socials[network] && re.test(s)) socials[network] = s;
      }
    }
  }

  const rankedEmails = [...emails.values()].sort(
    (a, b) => Number(b.sameDomain) - Number(a.sameDomain) || Number(a.generic) - Number(b.generic) || a.value.localeCompare(b.value),
  );
  return {
    emails: rankedEmails.slice(0, 10),
    phones: [...phones.values()].slice(0, 5),
    whatsapp: [...whatsapp].slice(0, 3),
    socials,
    organization,
    pagesScanned: pages.map((p) => p.url),
  };
}
