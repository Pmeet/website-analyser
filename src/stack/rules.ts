import type { TechDefinition } from "./types";

/**
 * Built-in fingerprints (written for this project, Apache-2.0). They cover what matters for the
 * report — platform, analytics, pixels, chat, booking, CRM, forms, consent, reviews — so the
 * analyser works without the optional webappanalyzer dataset (see scripts/update-fingerprints.mjs).
 * Same pattern syntax as Wappalyzer: regex strings, case-insensitive, with optional
 * "\\;version:\\1" / "\\;confidence:50" suffixes.
 */
export const CUSTOM_CATEGORIES: Record<number, string> = {
  1001: "Chatbot",
  1002: "Messaging widget",
};

const t = (cats: number[], def: Omit<TechDefinition, "cats"> = {}): TechDefinition => ({ cats, ...def });

export const BUILTIN_RULES: Record<string, TechDefinition> = {
  // ── Platforms ───────────────────────────────────────────────────────────────
  WordPress: t([1, 11], {
    meta: { generator: "^WordPress(?: ([\\d.]+))?\\;version:\\1" },
    html: ["/wp-content/", "/wp-includes/"],
    headers: { link: "rel=\"https://api\\.w\\.org/\"" },
  }),
  WooCommerce: t([6], { html: ["woocommerce"], meta: { generator: "WooCommerce ([\\d.]+)\\;version:\\1" }, implies: "WordPress" }),
  Elementor: t([51], { html: ["elementor-"], meta: { generator: "Elementor ([\\d.]+)\\;version:\\1" }, implies: "WordPress" }),
  Divi: t([51], { html: ["et_pb_", "/themes/Divi/"], implies: "WordPress" }),
  wpBakery: t([51], { html: ["vc_row", "js_composer"], implies: "WordPress" }),
  Webflow: t([1, 51], { html: ["data-wf-page", "data-wf-site"], meta: { generator: "Webflow" }, scriptSrc: ["webflow\\.(?:com|io)"] }),
  Wix: t([1, 51], { meta: { generator: "Wix\\.com" }, html: ["static\\.wixstatic\\.com", "wix-bolt"], headers: { "x-wix-request-id": "" } }),
  Squarespace: t([1, 51], { html: ["static1\\.squarespace\\.com", "Static\\.SQUARESPACE_CONTEXT"], headers: { server: "Squarespace" } }),
  Shopify: t([6], { html: ["cdn\\.shopify\\.com", "Shopify\\.theme"], headers: { "x-shopid": "", "x-shopify-stage": "" } }),
  "Framer Sites": t([51], { meta: { generator: "Framer" }, html: ["framerusercontent\\.com"] }),
  Duda: t([51], { html: ["dudaone|cdn-website\\.com|dmAlbum"] }),
  "GoDaddy Website Builder": t([51], { meta: { generator: "Starfield Technologies; Go Daddy Website Builder|GoDaddy" }, html: ["img1\\.wsimg\\.com"] }),
  "HubSpot CMS Hub": t([1], { meta: { generator: "HubSpot" }, headers: { "x-hs-hub-id": "" } }),
  Joomla: t([1], { meta: { generator: "Joomla!?(?: ([\\d.]+))?\\;version:\\1" } }),
  Drupal: t([1], { meta: { generator: "^Drupal(?: ([\\d.]+))?\\;version:\\1" }, headers: { "x-generator": "Drupal(?: ([\\d.]+))?\\;version:\\1" } }),
  Ghost: t([1, 11], { meta: { generator: "Ghost(?: ([\\d.]+))?\\;version:\\1" } }),
  Magento: t([6], { html: ["Mage\\.Cookies", "/static/version\\d+/frontend/"] }),
  BigCommerce: t([6], { html: ["cdn\\d*\\.bigcommerce\\.com"] }),
  Weebly: t([1], { html: ["editmysite\\.com"] }),
  Jimdo: t([1], { html: ["jimdo(?:cdn)?\\.com"] }),
  "Next.js": t([18], { html: ["__NEXT_DATA__", "/_next/static/"], headers: { "x-powered-by": "^Next\\.js ?([\\d.]+)?\\;version:\\1" } }),
  "Nuxt.js": t([18], { html: ["__NUXT__|/_nuxt/"] }),
  Gatsby: t([57], { html: ["___gatsby"], meta: { generator: "Gatsby(?: ([\\d.]+))?\\;version:\\1" } }),
  Astro: t([57], { meta: { generator: "Astro v?([\\d.]+)\\;version:\\1" } }),
  Hugo: t([57], { meta: { generator: "Hugo ([\\d.]+)\\;version:\\1" } }),
  React: t([12], { html: ["data-reactroot"] }),

  // ── Servers, hosting, CDN ───────────────────────────────────────────────────
  Cloudflare: t([31], { headers: { "cf-ray": "" } }),
  Vercel: t([62], { headers: { "x-vercel-id": "" } }),
  Netlify: t([62], { headers: { "x-nf-request-id": "" } }),
  "WP Engine": t([88], { headers: { "x-powered-by": "WP Engine" } }),
  Kinsta: t([88], { headers: { "x-kinsta-cache": "" } }),
  Nginx: t([22], { headers: { server: "nginx(?:/([\\d.]+))?\\;version:\\1" } }),
  "Apache HTTP Server": t([22], { headers: { server: "Apache(?:/([\\d.]+))?\\;version:\\1" } }),
  LiteSpeed: t([22], { headers: { server: "LiteSpeed" } }),
  IIS: t([22], { headers: { server: "Microsoft-IIS(?:/([\\d.]+))?\\;version:\\1" } }),
  PHP: t([27], { headers: { "x-powered-by": "PHP(?:/([\\d.]+))?\\;version:\\1" } }),

  // ── Analytics & tag managers ───────────────────────────────────────────────
  "Google Analytics": t([10], { scriptSrc: ["googletagmanager\\.com/gtag/js\\?id=G-", "google-analytics\\.com/(?:ga|analytics)\\.js"], scripts: ["gtag\\(['\"]config['\"],\\s*['\"]G-"] }),
  "Google Tag Manager": t([42], { scriptSrc: ["googletagmanager\\.com/gtm\\.js"], scripts: ["googletagmanager\\.com/gtm\\.js"], html: ["googletagmanager\\.com/ns\\.html"] }),
  "Microsoft Clarity": t([10], { scripts: ["clarity\\.ms/tag"], scriptSrc: ["clarity\\.ms/tag"] }),
  Hotjar: t([10], { scripts: ["static\\.hotjar\\.com"], scriptSrc: ["static\\.hotjar\\.com"] }),
  Plausible: t([10], { scriptSrc: ["plausible\\.io/js"] }),
  Fathom: t([10], { scriptSrc: ["cdn\\.usefathom\\.com"] }),
  "Matomo Analytics": t([10], { scripts: ["_paq\\.push"], scriptSrc: ["matomo\\.js|piwik\\.js"] }),
  Segment: t([10], { scripts: ["cdn\\.segment\\.com/analytics\\.js"] }),
  Mixpanel: t([10], { scripts: ["cdn\\.mxpnl\\.com|mixpanel\\.init"] }),

  // ── Advertising / retargeting pixels ───────────────────────────────────────
  "Facebook Pixel": t([77, 36], { scripts: ["connect\\.facebook\\.net/[^\"']*/fbevents\\.js", "fbq\\(['\"]init"], html: ["facebook\\.com/tr\\?id="] }),
  "Google Ads": t([36], { scriptSrc: ["googletagmanager\\.com/gtag/js\\?id=AW-", "googleadservices\\.com"], scripts: ["['\"]AW-\\d+"] }),
  "Linkedin Insight Tag": t([77, 36], { scripts: ["snap\\.licdn\\.com/li\\.lms-analytics", "_linkedin_partner_id"] }),
  "TikTok Pixel": t([77, 36], { scripts: ["analytics\\.tiktok\\.com"] }),
  "Snap Pixel": t([77, 36], { scripts: ["sc-static\\.net/scevent"] }),
  "Pinterest Conversion Tag": t([77, 36], { scripts: ["s\\.pinimg\\.com/ct/core\\.js"] }),
  "X (Twitter) Pixel": t([77, 36], { scripts: ["static\\.ads-twitter\\.com/uwt\\.js"] }),

  // ── Live chat ──────────────────────────────────────────────────────────────
  Intercom: t([52], { scriptSrc: ["widget\\.intercom\\.io|js\\.intercomcdn\\.com"], scripts: ["widget\\.intercom\\.io"] }),
  Drift: t([52, 1001], { scriptSrc: ["js\\.driftt\\.com"], scripts: ["js\\.driftt\\.com"] }),
  "Crisp Live Chat": t([52], { scriptSrc: ["client\\.crisp\\.chat"], scripts: ["client\\.crisp\\.chat"] }),
  "Tawk.to": t([52], { scriptSrc: ["embed\\.tawk\\.to"], scripts: ["embed\\.tawk\\.to"] }),
  "Zendesk Chat": t([52], { scriptSrc: ["static\\.zdassets\\.com/ekr/snippet|v2\\.zopim\\.com"], scripts: ["static\\.zdassets\\.com|zopim"] }),
  LiveChat: t([52], { scripts: ["cdn\\.livechatinc\\.com"], scriptSrc: ["cdn\\.livechatinc\\.com"] }),
  Tidio: t([52, 1001], { scriptSrc: ["code\\.tidio\\.co"] }),
  "HubSpot Chat": t([52], { scriptSrc: ["js\\.usemessages\\.com"] }),
  Freshchat: t([52], { scriptSrc: ["wchat\\.freshchat\\.com|fw-cdn\\.com"] }),
  Olark: t([52], { scripts: ["static\\.olark\\.com"] }),
  Gorgias: t([52], { scriptSrc: ["config\\.gorgias\\.chat"] }),
  Chatwoot: t([52], { scripts: ["chatwootSDK"] }),
  Smartsupp: t([52], { scripts: ["smartsuppchat\\.com"] }),
  UserLike: t([52], { scriptSrc: ["userlike-cdn-widgets"] }),
  "Zoho SalesIQ": t([52, 53], { scripts: ["salesiq\\.zoho"], scriptSrc: ["salesiq\\.zoho"] }),
  "Facebook Chat Plugin": t([52], { html: ["fb-customerchat"] }),

  // ── Chatbots / AI assistants ───────────────────────────────────────────────
  ManyChat: t([1001], { scriptSrc: ["widget\\.manychat\\.com"] }),
  Landbot: t([1001], { scriptSrc: ["cdn\\.landbot\\.io|static\\.landbot\\.io"], scripts: ["landbot\\.io"] }),
  Botpress: t([1001], { scriptSrc: ["cdn\\.botpress\\.cloud"] }),
  Voiceflow: t([1001], { scripts: ["cdn\\.voiceflow\\.com"] }),
  Chatbase: t([1001], { scriptSrc: ["chatbase\\.co/embed"], scripts: ["chatbase\\.co"] }),
  Ada: t([1001], { scriptSrc: ["static\\.ada\\.support"] }),

  // ── Messaging widgets (WhatsApp etc.) ──────────────────────────────────────
  "Elfsight WhatsApp": t([1002], { html: ["elfsight-app-[a-f0-9-]+[^>]*whatsapp"] }),
  "GetButton.io": t([1002], { scripts: ["static\\.getbutton\\.io"] }),
  Joinchat: t([1002], { html: ["joinchat"], implies: "WordPress" }),
  Wati: t([1002], { scripts: ["wati\\.io"] }),

  // ── Appointment scheduling & reservations ──────────────────────────────────
  Calendly: t([72], { scriptSrc: ["assets\\.calendly\\.com"], html: ["calendly\\.com/[a-z0-9_-]+"] }),
  "Acuity Scheduling": t([72], { html: ["acuityscheduling\\.com|as\\.me/"] }),
  "Cal.com": t([72], { html: ["(?:app\\.)?cal\\.com/[a-z0-9_-]+"], scripts: ["app\\.cal\\.com/embed"] }),
  "SimplyBook.me": t([72], { html: ["simplybook\\.(?:me|it|asia)"] }),
  Setmore: t([72], { html: ["setmore\\.com"] }),
  "Square Appointments": t([72], { html: ["squareup\\.com/appointments|book\\.squareup\\.com"] }),
  Fresha: t([72], { html: ["fresha\\.com"] }),
  Booksy: t([72], { html: ["booksy\\.com"] }),
  MindBody: t([72], { html: ["mindbodyonline\\.com|healcode"] }),
  "HubSpot Meetings": t([72], { html: ["meetings\\.hubspot\\.com|meetings-eu1\\.hubspot\\.com"] }),
  "Zoho Bookings": t([72], { html: ["zohobookings\\.|bookings\\.zoho\\."] }),
  "Microsoft Bookings": t([72], { html: ["outlook\\.office365?\\.com/(?:owa/calendar|book)/"] }),
  YouCanBookMe: t([72], { html: ["youcanbook\\.me"] }),
  TidyCal: t([72], { html: ["tidycal\\.com"] }),
  SavvyCal: t([72], { html: ["savvycal\\.com"] }),
  Vagaro: t([72], { html: ["vagaro\\.com"] }),
  Treatwell: t([72], { html: ["treatwell\\.(?:co\\.uk|com|ae)"] }),
  "Jane App": t([72], { html: ["janeapp\\.com"] }),
  OpenTable: t([93], { html: ["opentable\\.(?:com|co\\.uk|ae)"] }),
  SevenRooms: t([93], { html: ["sevenrooms\\.com"] }),
  ResDiary: t([93], { html: ["resdiary\\.com"] }),

  // ── CRM & marketing automation ─────────────────────────────────────────────
  HubSpot: t([53, 32], { scriptSrc: ["js(?:-eu1)?\\.hs-scripts\\.com|js\\.hs-analytics\\.net|js\\.hsforms\\.net"], scripts: ["hs-scripts\\.com|hbspt\\.forms"] }),
  Salesforce: t([53], { html: ["webto(?:lead|case)\\.salesforce\\.com|force\\.com/servlet/servlet\\.WebToLead"] }),
  Pardot: t([32], { scripts: ["pi\\.pardot\\.com|piAId"] }),
  Marketo: t([32], { scripts: ["munchkin\\.marketo\\.net"], scriptSrc: ["munchkin\\.marketo\\.net"] }),
  "Zoho CRM": t([53], { html: ["crm\\.zoho\\.(?:com|eu|in)/crm/WebToLeadForm"] }),
  Pipedrive: t([53], { html: ["webforms\\.pipedrive\\.com|leadbooster"] }),
  ActiveCampaign: t([32], { html: ["activehosted\\.com"], scripts: ["trackcmp\\.net"] }),
  Keap: t([53, 32], { html: ["infusionsoft\\.(?:com|app)|keap\\.app"] }),
  "GoHighLevel": t([53, 32], { html: ["leadconnectorhq\\.com|msgsndr\\.com|link\\.msgsndr"] }),
  "Freshsales": t([53], { scriptSrc: ["myfreshworks\\.com/crm"] }),
  Brevo: t([32, 75], { html: ["sibforms\\.com|sendinblue\\.com|brevo\\.com"] }),
  Klaviyo: t([32, 75], { scriptSrc: ["static\\.klaviyo\\.com"], scripts: ["klaviyo"] }),
  MailChimp: t([75], { html: ["list-manage\\.com|mc\\.us\\d+\\.list-manage|chimpstatic\\.com"] }),
  "Kit (ConvertKit)": t([75], { html: ["convertkit\\.com|ck\\.page|kit\\.com/forms"] }),
  MailerLite: t([75], { html: ["mailerlite\\.com|ml-form-embed"] }),
  Omnisend: t([75], { scripts: ["omnisnippet|omnisend"] }),
  Aweber: t([75], { html: ["forms\\.aweber\\.com"] }),
  "Constant Contact": t([75], { html: ["ctctcdn\\.com|constantcontact\\.com"] }),
  Beehiiv: t([75], { html: ["embeds\\.beehiiv\\.com"] }),

  // ── Form builders / handlers ───────────────────────────────────────────────
  "Contact Form 7": t([110], { html: ["wpcf7"], implies: "WordPress" }),
  "Gravity Forms": t([110], { html: ["gform_wrapper|gravityforms"], implies: "WordPress" }),
  WPForms: t([110], { html: ["wpforms-"], implies: "WordPress" }),
  "Ninja Forms": t([110], { html: ["nf-form-cont"], implies: "WordPress" }),
  "Fluent Forms": t([110], { html: ["fluentform"], implies: "WordPress" }),
  Typeform: t([110], { html: ["typeform\\.com/to/|embed\\.typeform\\.com|data-tf-widget"] }),
  Jotform: t([110], { html: ["jotform\\.(?:com|us)|jotfor\\.ms"] }),
  "Google Forms": t([110], { html: ["docs\\.google\\.com/forms|forms\\.gle"] }),
  Tally: t([110], { html: ["tally\\.so"] }),
  Formspree: t([110], { html: ["formspree\\.io"] }),
  "Netlify Forms": t([110], { html: ["data-netlify=[\"']true|netlify-honeypot"] }),
  Formstack: t([110], { html: ["formstack\\.com"] }),

  // ── Cookie consent ─────────────────────────────────────────────────────────
  Cookiebot: t([67], { scriptSrc: ["consent\\.cookiebot\\.(?:com|eu)"], scripts: ["consent\\.cookiebot"] }),
  OneTrust: t([67], { scriptSrc: ["cdn\\.cookielaw\\.org|optanon"], scripts: ["cookielaw\\.org"] }),
  CookieYes: t([67], { scriptSrc: ["cdn-cookieyes\\.com"], html: ["cookie-law-info|cky-consent"] }),
  Termly: t([67], { scriptSrc: ["app\\.termly\\.io"] }),
  Osano: t([67], { scriptSrc: ["cmp\\.osano\\.com"] }),
  iubenda: t([67], { scriptSrc: ["cdn\\.iubenda\\.com|cs\\.iubenda\\.com"] }),
  Complianz: t([67], { html: ["cmplz-"], implies: "WordPress" }),
  Usercentrics: t([67], { scriptSrc: ["usercentrics\\.eu|usercentrics\\.com"] }),
  Didomi: t([67], { scripts: ["sdk\\.privacy-center\\.org|didomi"] }),
  "Cookie-Script": t([67], { scriptSrc: ["cookie-script\\.com"] }),
  "Cookie Notice": t([67], { html: ["cookie-notice-container"] }),
  "Silktide Consent": t([67], { scriptSrc: ["silktide"] }),
  "Civic Cookie Control": t([67], { scriptSrc: ["cc\\.cdn\\.civiccomputing\\.com"] }),
  Axeptio: t([67], { scripts: ["axept\\.io"] }),
  "Borlabs Cookie": t([67], { html: ["BorlabsCookie|borlabs-cookie"] }),
  Klaro: t([67], { scriptSrc: ["klaro"] }),
  TrustArc: t([67], { scriptSrc: ["consent\\.trustarc\\.com"] }),
  "Shopify Consent Management": t([67], { scripts: ["shopify-privacy-banner|customerPrivacy"] }),

  // ── Reviews / social proof ─────────────────────────────────────────────────
  Trustpilot: t([90], { scriptSrc: ["widget\\.trustpilot\\.com"], html: ["trustpilot-widget"] }),
  "Reviews.io": t([90], { html: ["reviews\\.io|reviews\\.co\\.uk"] }),
  Feefo: t([90], { html: ["api\\.feefo\\.com|feefo-widget"] }),
  "Yotpo Reviews": t([90], { scriptSrc: ["staticw2\\.yotpo\\.com|cdn-widgetsrepository\\.yotpo"] }),
  "Judge.me": t([90], { html: ["judge\\.me|jdgm-"] }),
  Trustindex: t([90], { html: ["trustindex\\.io|ti-widget"] }),
  "Elfsight Reviews": t([90], { scriptSrc: ["static\\.elfsight\\.com|elfsightcdn\\.com"] }),
  EmbedSocial: t([90], { html: ["embedsocial\\.com"] }),

  // ── Payments ──────────────────────────────────────────────────────────────
  Stripe: t([41], { scriptSrc: ["js\\.stripe\\.com"] }),
  PayPal: t([41], { scriptSrc: ["paypal\\.com/sdk|paypalobjects\\.com"] }),
};
