export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  ANALYSIS_QUEUE?: Queue<QueueMessage>;
  AI?: Ai;
  ACCESS_TOKEN?: string;
  PAGESPEED_API_KEY?: string;
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
}

export interface QueueMessage {
  batchId: string;
  itemId: string;
}

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type Category =
  | "performance"
  | "seo"
  | "security"
  | "email"
  | "automation"
  | "conversion"
  | "compliance"
  | "data";

export interface Finding {
  id: string;
  category: Category;
  severity: Severity;
  /** Short line used as a report bullet, e.g. "No DMARC — emails may hit spam". */
  title: string;
  detail?: string;
  /** Outreach-friendly phrasing used for the template hook when no LLM is configured. */
  hook?: string;
  /** Tie-breaker inside a severity band (0–10). */
  impact?: number;
}

export interface CheckStatus {
  ok: boolean;
  ms: number;
  error?: string;
  skipped?: string;
}

/** Everything extracted from one HTML document. */
export interface PageData {
  url: string;
  status: number;
  html: string;
  text: string;
  lang: string | null;
  title: string | null;
  metas: { name?: string; property?: string; httpEquiv?: string; content: string }[];
  links: { rel: string; href: string; hreflang?: string }[];
  headings: { h1: string[]; h2: string[] };
  images: { src: string; alt: string | null; loading?: string }[];
  anchors: { href: string; text: string; rel?: string }[];
  scripts: { src?: string; type?: string; inline?: string }[];
  iframes: string[];
  forms: { action: string; method: string; inputs: { type: string; name: string; placeholder: string }[]; text: string }[];
  buttons: string[];
  jsonLd: unknown[];
  stylesheets: string[];
}

export interface FetchedPage {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  setCookies: string[];
  html: string;
  ms: number;
  redirects: number;
  blocked: boolean;
  usedBrowserRendering: boolean;
}

export interface Tech {
  name: string;
  categories: string[];
  version?: string;
  confidence: number;
  website?: string;
}

export interface PageSpeedResult {
  strategy: "mobile" | "desktop";
  scores: { performance: number | null; seo: number | null; accessibility: number | null; bestPractices: number | null };
  lab: { lcpMs?: number; fcpMs?: number; cls?: number; tbtMs?: number; speedIndexMs?: number; ttiMs?: number };
  field: {
    source: "url" | "origin" | null;
    overall?: string;
    lcpMs?: number;
    inpMs?: number;
    cls?: number;
    fcpMs?: number;
    ttfbMs?: number;
    categories: Record<string, string>;
  };
  lcpElement?: { snippet?: string; label?: string; imageUrl?: string; imageBytes?: number };
  totalBytes?: number;
  opportunities: { id: string; title: string; displayValue?: string; savingsMs?: number; savingsBytes?: number }[];
  failedAudits: { id: string; title: string; category: string; displayValue?: string }[];
}

export interface SeoResult {
  title: string | null;
  titleLength: number;
  metaDescription: string | null;
  metaDescriptionLength: number;
  h1: string[];
  canonical: string | null;
  lang: string | null;
  viewport: string | null;
  robotsMeta: string | null;
  og: Record<string, string>;
  twitterCard: string | null;
  images: { total: number; missingAlt: number };
  jsonLdTypes: string[];
  robotsTxt: { found: boolean; disallowAll: boolean; sitemaps: string[] } | null;
  sitemap: { found: boolean; url: string | null; urlCount: number | null } | null;
  brokenLinks: { checked: number; broken: { url: string; status: number | string }[] } | null;
  score: number;
}

export interface SecurityResult {
  https: boolean;
  httpRedirectsToHttps: boolean | null;
  headers: Record<string, string | null>;
  missingHeaders: string[];
  mixedContent: string[];
  exposedVersions: string[];
  certificate: { issuer?: string; notAfter?: string; daysLeft?: number; source: "crt.sh" } | null;
  tlsError: string | null;
  observatory: { grade: string; score: number; testsFailed: number; testsPassed: number; detailsUrl?: string } | null;
  internalScore: number;
  internalGrade: string;
}

export interface EmailResult {
  domain: string;
  mx: string[];
  mxProvider: string | null;
  spf: { record: string | null; count: number; allQualifier: string | null };
  dmarc: { record: string | null; policy: string | null; rua: boolean };
  dkim: { selectorsFound: string[]; selectorsTried: string[] };
  score: number;
}

export interface AutomationResult {
  liveChat: string[];
  chatbot: string[];
  booking: string[];
  crm: string[];
  forms: { count: number; handlers: string[]; feedsCrm: boolean };
  whatsapp: boolean;
  newsletter: string[];
  newsletterForm: boolean;
  analytics: string[];
  pixels: string[];
  regionHint: "uae" | "uk" | "eu" | "other";
}

export interface ContactResult {
  emails: { value: string; generic: boolean; sameDomain: boolean; source: string }[];
  phones: { value: string; source: string }[];
  whatsapp: string[];
  socials: Record<string, string>;
  organization: { name?: string; address?: string; telephone?: string; email?: string } | null;
  pagesScanned: string[];
}

export interface ExtrasResult {
  cookieConsent: string[];
  ctas: string[];
  testimonials: string[];
  copyrightYear: number | null;
  domain: { registered?: string; ageYears?: number; registrar?: string } | null;
  viewportOk: boolean;
  tapTargetsOk: boolean | null;
}

export interface Scores {
  performance: number | null;
  seo: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  security: { grade: string; score: number; source: "observatory" | "internal" };
  email: number;
  overall: number;
}

export interface AnalysisResult {
  input: string;
  url: string;
  finalUrl: string;
  host: string;
  domain: string;
  businessName: string | null;
  analyzedAt: string;
  durationMs: number;
  fetch: {
    status: number;
    error?: string;
    blocked: boolean;
    jsRendered: boolean;
    usedBrowserRendering: boolean;
    bytes: number;
    ms: number;
  };
  scores: Scores;
  pagespeed: PageSpeedResult | null;
  seo: SeoResult | null;
  security: SecurityResult | null;
  email: EmailResult | null;
  stack: Tech[];
  automation: AutomationResult | null;
  contacts: ContactResult | null;
  extras: ExtrasResult | null;
  findings: Finding[];
  hook: { text: string; source: "ai" | "template"; provider?: string; error?: string } | null;
  checks: Record<string, CheckStatus>;
}
