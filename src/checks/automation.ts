import type { AutomationResult, ContactResult, ExtrasResult, PageData, PageSpeedResult, Tech } from "../types";
import { fetchWithTimeout, hostOf, resolveUrl } from "../lib/http";
import { hasCategory } from "../stack/detect";
import { jsonLdTypes, metaContent } from "./html";

const names = (techs: Tech[]) => [...new Set(techs.map((t) => t.name))];

const CRM_FORM_ACTION = /hsforms|hubspot|salesforce|force\.com|zoho|pipedrive|activehosted|leadconnector|msgsndr|klaviyo|infusionsoft|keap|marketo|pardot|freshworks|monday\.com|airtable|zapier|make\.com|integromat|n8n/i;
const WHATSAPP = /wa\.me\/|api\.whatsapp\.com|whatsapp:\/\/|web\.whatsapp\.com|whatsapp-(?:button|widget|chat)|wa-chat|joinchat/i;
const NEWSLETTER_TEXT = /newsletter|subscribe|sign\s*up for (?:our )?(?:updates|emails)|join (?:our )?(?:mailing )?list|stay (?:in the loop|updated)/i;
const EU_TLDS = /\.(eu|de|fr|ie|nl|be|es|it|pt|at|se|dk|fi|pl|cz|gr|lu)$/i;

function isContactForm(form: PageData["forms"][number]): boolean {
  const types = form.inputs.map((i) => i.type);
  const fields = form.inputs.map((i) => `${i.name} ${i.placeholder}`).join(" ");
  if (form.inputs.length === 1 && /search|^s$|query/.test(fields)) return false;
  if (/search/i.test(form.text) && form.inputs.length <= 2) return false;
  if (/password/.test(types.join(" "))) return false;
  return types.includes("textarea") || (types.includes("email") && form.inputs.length >= 3) || /message|enquiry|inquiry/.test(fields);
}

function isNewsletterForm(form: PageData["forms"][number]): boolean {
  const emailInputs = form.inputs.filter((i) => i.type === "email" || /email/.test(i.name));
  const visible = form.inputs.filter((i) => !["hidden", "submit", "button"].includes(i.type));
  return emailInputs.length >= 1 && visible.length <= 3 && (NEWSLETTER_TEXT.test(form.text) || NEWSLETTER_TEXT.test(form.action) || visible.length === 1);
}

export function regionHint(siteUrl: string, pages: PageData[], contacts: ContactResult | null): AutomationResult["regionHint"] {
  const host = hostOf(siteUrl);
  const phones = contacts?.phones.map((p) => p.value) ?? [];
  const text = pages.map((p) => p.text.slice(0, 50_000)).join(" ");
  if (/\.ae$/.test(host) || phones.some((p) => p.startsWith("+971")) || pages.some((p) => /^ar\b/i.test(p.lang ?? "")) || /\b(dubai|abu dhabi|sharjah|ajman|UAE|AED)\b/.test(text)) return "uae";
  if (/\.uk$/.test(host) || phones.some((p) => p.startsWith("+44")) || /\b(United Kingdom|London|Manchester|Birmingham|VAT No|Companies House)\b/.test(text)) return "uk";
  if (EU_TLDS.test(host)) return "eu";
  return "other";
}

export function analyseAutomation(stack: Tech[], pages: PageData[], siteUrl: string, contacts: ContactResult | null): AutomationResult {
  const ai = hasCategory(stack, "Artificial Intelligence").filter((t) => /chat|bot|assistant|agent/i.test(t.name));
  const contactForms = pages.flatMap((p) => p.forms.filter(isContactForm).map((f) => ({ f, base: p.url })));
  const handlers = new Set<string>(names(hasCategory(stack, "Form builders")));
  let actionFeedsCrm = false;
  for (const { f, base } of contactForms) {
    const abs = f.action ? resolveUrl(f.action, base) : null;
    if (abs && CRM_FORM_ACTION.test(abs)) actionFeedsCrm = true;
    if (abs && /^https?:/.test(abs) && hostOf(abs) !== hostOf(base)) handlers.add(hostOf(abs));
  }
  const crm = names([...hasCategory(stack, "CRM"), ...hasCategory(stack, "Marketing automation")]);
  const allAnchors = pages.flatMap((p) => p.anchors.map((a) => a.href));
  const whatsapp =
    allAnchors.some((h) => WHATSAPP.test(h)) ||
    hasCategory(stack, "Messaging widget").length > 0 ||
    pages.some((p) => /whatsapp/i.test(p.scripts.map((s) => s.src ?? "").join(" ")));
  const newsletterForms = pages.some((p) => p.forms.some(isNewsletterForm));

  return {
    liveChat: names(hasCategory(stack, "Live chat")),
    chatbot: names([...hasCategory(stack, "Chatbot"), ...ai]),
    booking: names([...hasCategory(stack, "Appointment scheduling"), ...hasCategory(stack, "Reservations & delivery"), ...hasCategory(stack, "Ticket booking")]),
    crm,
    forms: { count: contactForms.length, handlers: [...handlers], feedsCrm: actionFeedsCrm || crm.length > 0 },
    whatsapp,
    newsletter: names(hasCategory(stack, "Email")),
    newsletterForm: newsletterForms,
    analytics: names([...hasCategory(stack, "Analytics"), ...hasCategory(stack, "Tag managers")]),
    pixels: names(hasCategory(stack, "Retargeting").concat(hasCategory(stack, "Advertising").filter((t) => /pixel|ads|tag|insight/i.test(t.name)))),
    regionHint: regionHint(siteUrl, pages, contacts),
  };
}

// ── Extras: consent, conversion elements, copyright, domain age ──────────────

const CONSENT_TEXT = /we use cookies|accept (?:all )?cookies|cookie (?:consent|settings|preferences)|manage (?:cookie|consent)|reject (?:all|non-essential)/i;
const CTA_TEXT = /\b(book|schedule|get (?:a |your )?(?:free )?(?:quote|started|in touch|estimate|consultation|demo)|contact us|call (?:us|now|today)|request|enquire|inquire|buy now|shop now|order now|sign up|start (?:now|free|your)|try (?:it )?(?:free|now)|free trial|consultation|get a call|talk to|let'?s talk|apply now|reserve)\b/i;
const TESTIMONIAL_TEXT = /testimonials?|what (?:our )?(?:clients|customers|patients|students) (?:say|are saying)|client reviews|customer reviews|google reviews|★{4,}|\b[45](?:\.\d)?\s*(?:\/\s*5|stars?)\b|rated (?:excellent|[45])|case stud(?:y|ies)/i;

export function copyrightYear(text: string): number | null {
  let max: number | null = null;
  for (const m of text.matchAll(/(?:©|\(c\)|copyright)\s*(?:\d{4}\s*[-–—]\s*)?(\d{4})/gi)) {
    const y = Number(m[1]);
    if (y >= 1995 && y <= new Date().getUTCFullYear() + 1) max = Math.max(max ?? 0, y);
  }
  return max;
}

export async function domainAge(domain: string): Promise<ExtrasResult["domain"]> {
  const res = await fetchWithTimeout(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { headers: { accept: "application/rdap+json" } }, 10_000);
  if (!res.ok) throw new Error(`RDAP HTTP ${res.status}`);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const body = (await res.json()) as any;
  const registered: string | undefined = body.events?.find((e: any) => e.eventAction === "registration")?.eventDate;
  const registrarEntity = body.entities?.find((e: any) => e.roles?.includes("registrar"));
  const fn = registrarEntity?.vcardArray?.[1]?.find((v: any) => v[0] === "fn")?.[3];
  const ageYears = registered ? Math.floor(((Date.now() - Date.parse(registered)) / (365.25 * 86_400_000)) * 10) / 10 : undefined;
  return { registered, ageYears, registrar: typeof fn === "string" ? fn : undefined };
}

export function analyseExtras(stack: Tech[], pages: PageData[], pagespeed: PageSpeedResult | null): Omit<ExtrasResult, "domain"> {
  const home = pages[0];
  const consent = names(hasCategory(stack, "Cookie compliance"));
  if (!consent.length && pages.some((p) => CONSENT_TEXT.test(p.text) || CONSENT_TEXT.test(p.scripts.map((s) => s.inline ?? "").join(" ").slice(0, 300_000)))) {
    consent.push("Cookie banner (text match)");
  }

  const ctaCandidates = [...home.buttons, ...home.anchors.map((a) => a.text)].map((t) => t.trim()).filter((t) => t.length > 1 && t.length < 50);
  const ctas = [...new Set(ctaCandidates.filter((t) => CTA_TEXT.test(t)))].slice(0, 8);

  const testimonials = new Set<string>(names(hasCategory(stack, "Reviews")));
  for (const p of pages) {
    const m = p.text.match(TESTIMONIAL_TEXT);
    if (m) testimonials.add(`"${m[0].trim()}" on ${new URL(p.url).pathname || "/"}`);
    if (jsonLdTypes(p).some((t) => /Review|AggregateRating/i.test(t))) testimonials.add("Review schema");
  }

  const viewport = metaContent(home, "viewport") ?? "";
  const tapAudit = pagespeed?.failedAudits.find((a) => a.id === "target-size" || a.id === "tap-targets");
  return {
    cookieConsent: consent,
    ctas,
    testimonials: [...testimonials].slice(0, 5),
    copyrightYear: copyrightYear(home.text),
    viewportOk: /width\s*=\s*device-width/i.test(viewport),
    tapTargetsOk: pagespeed ? !tapAudit : null,
  };
}
