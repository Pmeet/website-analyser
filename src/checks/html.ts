import type { PageData } from "../types";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", trade: "™",
  ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", pound: "£", euro: "€",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? m;
  });
}

const squash = (s: string) => decodeEntities(s).replace(/\s+/g, " ").trim();

/** Readable text of a document: strips scripts, styles, SVGs, comments and tags. */
export function visibleText(html: string): string {
  return squash(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

/** Parses a document with HTMLRewriter into the structured fields every check uses. */
export async function extractPage(html: string, url: string, status = 200): Promise<PageData> {
  const data: PageData = {
    url,
    status,
    html,
    text: visibleText(html),
    lang: null,
    title: null,
    metas: [],
    links: [],
    headings: { h1: [], h2: [] },
    images: [],
    anchors: [],
    scripts: [],
    iframes: [],
    forms: [],
    buttons: [],
    jsonLd: [],
    stylesheets: [],
  };

  let title = "";
  let titleDone = false;
  let currentAnchor: PageData["anchors"][number] | null = null;
  let currentButton: { text: string } | null = null;
  let currentForm: PageData["forms"][number] | null = null;
  let currentHeading: { level: "h1" | "h2"; text: string } | null = null;
  let currentScript: { entry: PageData["scripts"][number]; text: string } | null = null;

  const rewriter = new HTMLRewriter()
    .on("html", {
      element(el) {
        data.lang = el.getAttribute("lang");
      },
    })
    .on("title", {
      text(t) {
        if (!titleDone) title += t.text;
        if (t.lastInTextNode) titleDone = title.trim().length > 0;
      },
    })
    .on("meta", {
      element(el) {
        const content = el.getAttribute("content");
        if (content === null) return;
        data.metas.push({
          name: el.getAttribute("name")?.toLowerCase() ?? undefined,
          property: el.getAttribute("property")?.toLowerCase() ?? undefined,
          httpEquiv: el.getAttribute("http-equiv")?.toLowerCase() ?? undefined,
          content: decodeEntities(content),
        });
      },
    })
    .on("link", {
      element(el) {
        const rel = (el.getAttribute("rel") ?? "").toLowerCase();
        const href = el.getAttribute("href");
        if (!href) return;
        data.links.push({ rel, href, hreflang: el.getAttribute("hreflang") ?? undefined });
        if (rel.includes("stylesheet")) data.stylesheets.push(href);
      },
    })
    .on("h1, h2", {
      element(el) {
        currentHeading = { level: el.tagName.toLowerCase() as "h1" | "h2", text: "" };
        const heading = currentHeading;
        el.onEndTag(() => {
          data.headings[heading.level].push(squash(heading.text));
          if (currentHeading === heading) currentHeading = null;
        });
      },
      text(t) {
        if (currentHeading) currentHeading.text += t.text;
      },
    })
    .on("img", {
      element(el) {
        const src = el.getAttribute("src") ?? el.getAttribute("data-src") ?? "";
        data.images.push({ src, alt: el.getAttribute("alt"), loading: el.getAttribute("loading") ?? undefined });
      },
    })
    .on("a", {
      element(el) {
        const href = el.getAttribute("href");
        if (href === null) return;
        const anchor = { href: decodeEntities(href.trim()), text: "", rel: el.getAttribute("rel") ?? undefined };
        // Fold aria-label/title in so icon-only links (WhatsApp, socials) still have text.
        const label = el.getAttribute("aria-label") ?? el.getAttribute("title");
        if (label) anchor.text = `${label} `;
        data.anchors.push(anchor);
        currentAnchor = anchor;
        el.onEndTag(() => {
          anchor.text = squash(anchor.text);
          if (currentAnchor === anchor) currentAnchor = null;
        });
      },
      text(t) {
        if (currentAnchor) currentAnchor.text += t.text;
      },
    })
    .on("button, input[type=submit], input[type=button]", {
      element(el) {
        if (el.tagName.toLowerCase() === "input") {
          const value = el.getAttribute("value");
          if (value) data.buttons.push(squash(value));
          return;
        }
        const button = { text: el.getAttribute("aria-label") ?? "" };
        currentButton = button;
        el.onEndTag(() => {
          const text = squash(button.text);
          if (text) data.buttons.push(text);
          if (currentButton === button) currentButton = null;
        });
      },
      text(t) {
        if (currentButton) currentButton.text += t.text;
      },
    })
    .on("script", {
      element(el) {
        const entry: PageData["scripts"][number] = {
          src: el.getAttribute("src") ?? undefined,
          type: el.getAttribute("type")?.toLowerCase() ?? undefined,
        };
        data.scripts.push(entry);
        if (entry.src) return;
        const state = { entry, text: "" };
        currentScript = state;
        el.onEndTag(() => {
          state.entry.inline = state.text;
          if (state.entry.type === "application/ld+json") {
            try {
              data.jsonLd.push(JSON.parse(state.text));
            } catch {
              /* malformed JSON-LD is common; ignore */
            }
          }
          if (currentScript === state) currentScript = null;
        });
      },
      text(t) {
        if (currentScript && currentScript.text.length < 200_000) currentScript.text += t.text;
      },
    })
    .on("iframe", {
      element(el) {
        const src = el.getAttribute("src") ?? el.getAttribute("data-src");
        if (src) data.iframes.push(src);
      },
    })
    .on("form", {
      element(el) {
        const form = {
          action: el.getAttribute("action") ?? "",
          method: (el.getAttribute("method") ?? "get").toLowerCase(),
          inputs: [] as PageData["forms"][number]["inputs"],
          text: `${el.getAttribute("id") ?? ""} ${el.getAttribute("class") ?? ""} `,
        };
        data.forms.push(form);
        currentForm = form;
        el.onEndTag(() => {
          form.text = squash(form.text).slice(0, 500);
          if (currentForm === form) currentForm = null;
        });
      },
      text(t) {
        if (currentForm && currentForm.text.length < 2000) currentForm.text += t.text;
      },
    })
    .on("input, textarea, select", {
      element(el) {
        if (!currentForm) return;
        const tag = el.tagName.toLowerCase();
        currentForm.inputs.push({
          type: tag === "input" ? (el.getAttribute("type") ?? "text").toLowerCase() : tag,
          name: (el.getAttribute("name") ?? el.getAttribute("id") ?? "").toLowerCase(),
          placeholder: (el.getAttribute("placeholder") ?? "").toLowerCase(),
        });
      },
    });

  await rewriter.transform(new Response(html, { headers: { "content-type": "text/html" } })).arrayBuffer();
  data.title = title.trim() ? squash(title) : null;
  return data;
}

export function metaContent(page: PageData, key: string): string | null {
  const k = key.toLowerCase();
  const m = page.metas.find((x) => x.name === k || x.property === k);
  return m ? m.content.trim() : null;
}

/** Flattens JSON-LD (arrays, @graph) into a list of typed nodes. */
export function jsonLdNodes(page: PageData): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (obj["@graph"]) visit(obj["@graph"]);
    if (obj["@type"]) out.push(obj);
  };
  page.jsonLd.forEach(visit);
  return out;
}

export function jsonLdTypes(page: PageData): string[] {
  const types = new Set<string>();
  for (const node of jsonLdNodes(page)) {
    const t = node["@type"];
    (Array.isArray(t) ? t : [t]).forEach((x) => typeof x === "string" && types.add(x));
  }
  return [...types];
}
