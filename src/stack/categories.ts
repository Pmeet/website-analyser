/** Wappalyzer category ids that the analyser cares about. */
export const CATEGORY_NAMES: Record<number, string> = {
  1: "CMS",
  5: "Widgets",
  6: "Ecommerce",
  10: "Analytics",
  11: "Blogs",
  12: "JavaScript frameworks",
  18: "Web frameworks",
  22: "Web servers",
  27: "Programming languages",
  31: "CDN",
  32: "Marketing automation",
  36: "Advertising",
  41: "Payment processors",
  42: "Tag managers",
  51: "Page builders",
  52: "Live chat",
  53: "CRM",
  57: "Static site generator",
  62: "PaaS",
  67: "Cookie compliance",
  72: "Appointment scheduling",
  73: "Surveys",
  75: "Email",
  77: "Retargeting",
  80: "WordPress themes",
  87: "WordPress plugins",
  88: "Hosting",
  90: "Reviews",
  93: "Reservations & delivery",
  104: "Ticket booking",
  110: "Form builders",
  112: "Artificial Intelligence",
};

export const KEPT_CATEGORY_IDS = Object.keys(CATEGORY_NAMES).map(Number);

/** Categories that best describe "what the site is built on", in display priority order. */
export const PLATFORM_CATEGORIES = ["CMS", "Ecommerce", "Page builders", "Static site generator", "Blogs", "Web frameworks", "JavaScript frameworks"];
