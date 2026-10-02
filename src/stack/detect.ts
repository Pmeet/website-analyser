import type { FetchedPage, PageData, Tech } from "../types";
import { CATEGORY_NAMES } from "./categories";
import generated from "./fingerprints.generated.json";
import { BUILTIN_RULES, CUSTOM_CATEGORIES } from "./rules";
import type { FingerprintSet, PatternField, TechDefinition } from "./types";

interface Pattern {
  re: RegExp;
  version?: string;
  confidence: number;
}

interface Hit {
  confidence: number;
  version?: string;
}

const generatedSet = generated as unknown as FingerprintSet;

const compiledCache = new Map<"all" | "builtin", Map<string, CompiledTech>>();

interface CompiledTech {
  name: string;
  def: TechDefinition;
  html: Pattern[];
  text: Pattern[];
  scriptSrc: Pattern[];
  scripts: Pattern[];
  url: Pattern[];
  meta: [string, Pattern[]][];
  headers: [string, Pattern[]][];
  cookies: [string, Pattern[]][];
}

export function categoryName(id: number): string {
  return CUSTOM_CATEGORIES[id] ?? CATEGORY_NAMES[id] ?? generatedSet.categories?.[String(id)] ?? `Category ${id}`;
}

export function fingerprintCount(): { builtin: number; generated: number } {
  return { builtin: Object.keys(BUILTIN_RULES).length, generated: Object.keys(generatedSet.technologies ?? {}).length };
}

const asArray = (v: PatternField | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export function parsePattern(raw: string): Pattern | null {
  const [regex, ...attrs] = raw.split("\\;");
  const pattern: Pattern = { re: /(?:)/, confidence: 100 };
  try {
    pattern.re = new RegExp(regex, "i");
  } catch {
    return null;
  }
  for (const attr of attrs) {
    const idx = attr.indexOf(":");
    if (idx < 0) continue;
    const key = attr.slice(0, idx);
    const value = attr.slice(idx + 1);
    if (key === "version") pattern.version = value;
    if (key === "confidence") pattern.confidence = Number(value) || 0;
  }
  return pattern;
}

/** Resolves Wappalyzer version templates such as "\\1" or "\\1?4.x:3.x". */
export function resolveVersion(template: string | undefined, match: RegExpMatchArray): string | undefined {
  if (!template) return undefined;
  let v = template;
  for (let i = 0; i < match.length; i++) {
    const ternary = new RegExp(`\\\\${i}\\?([^:]*):(.*)$`);
    const t = v.match(ternary);
    if (t) v = v.replace(t[0], match[i] ? t[1] : t[2]);
    v = v.split(`\\${i}`).join(match[i] ?? "");
  }
  v = v.trim();
  return v && v.length < 30 ? v : undefined;
}

/** Combines a dataset definition with a built-in one of the same name (patterns are unioned). */
function mergeDefs(a: TechDefinition, b: TechDefinition): TechDefinition {
  const list = (x?: PatternField, y?: PatternField) => {
    const merged = [...asArray(x), ...asArray(y)];
    return merged.length ? merged : undefined;
  };
  const map = <T extends Record<string, unknown>>(x?: T, y?: T) => (x || y ? ({ ...(x ?? {}), ...(y ?? {}) } as T) : undefined);
  return {
    ...a,
    cats: [...new Set([...a.cats, ...b.cats])],
    html: list(a.html, b.html),
    text: list(a.text, b.text),
    scriptSrc: list(a.scriptSrc, b.scriptSrc),
    scripts: list(a.scripts, b.scripts),
    url: list(a.url, b.url),
    meta: map(a.meta, b.meta),
    headers: map(a.headers, b.headers),
    cookies: map(a.cookies, b.cookies),
    implies: list(a.implies, b.implies),
  };
}

const compileList = (v: PatternField | undefined) => asArray(v).map(parsePattern).filter((p): p is Pattern => p !== null);
const compileMap = (m: Record<string, PatternField> | undefined): [string, Pattern[]][] =>
  Object.entries(m ?? {}).map(([k, v]) => [k.toLowerCase(), compileList(v)]);

function compiled(builtinOnly = false): Map<string, CompiledTech> {
  const key = builtinOnly ? "builtin" : "all";
  const cached = compiledCache.get(key);
  if (cached) return cached;
  const all: Record<string, TechDefinition> = builtinOnly ? {} : { ...(generatedSet.technologies ?? {}) };
  for (const [name, def] of Object.entries(BUILTIN_RULES)) all[name] = all[name] ? mergeDefs(all[name], def) : def;
  const map = new Map<string, CompiledTech>();
  for (const [name, def] of Object.entries(all)) {
    map.set(name, {
      name,
      def,
      html: compileList(def.html),
      text: compileList(def.text),
      scriptSrc: compileList(def.scriptSrc),
      scripts: compileList(def.scripts),
      url: compileList(def.url),
      meta: compileMap(def.meta),
      headers: compileMap(def.headers),
      cookies: compileMap(def.cookies),
    });
  }
  compiledCache.set(key, map);
  return map;
}

function record(hits: Map<string, Hit>, name: string, pattern: Pattern, match: RegExpMatchArray) {
  const hit = hits.get(name) ?? { confidence: 0 };
  hit.confidence = Math.min(100, hit.confidence + pattern.confidence);
  hit.version ??= resolveVersion(pattern.version, match);
  hits.set(name, hit);
}

function testAll(hits: Map<string, Hit>, name: string, patterns: Pattern[], values: string[]) {
  for (const p of patterns) {
    for (const value of values) {
      const m = value.match(p.re);
      if (m) {
        record(hits, name, p, m);
        break;
      }
    }
  }
}

export function parseCookies(setCookies: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of setCookies) {
    // A combined header may contain several cookies separated by commas before the next name=.
    for (const part of line.split(/,(?=\s*[^;,=\s]+=)/)) {
      const [pair] = part.split(";");
      const idx = pair.indexOf("=");
      if (idx > 0) out[pair.slice(0, idx).trim().toLowerCase()] = pair.slice(idx + 1).trim();
    }
  }
  return out;
}

/** Evaluates `dom` fingerprints with a single HTMLRewriter pass. */
async function matchDom(html: string, techs: CompiledTech[], hits: Map<string, Hit>) {
  const textBuffers = new Map<string, { name: string; pattern: Pattern; text: string }>();
  let rewriter = new HTMLRewriter();
  let handlers = 0;
  for (const tech of techs) {
    const dom = tech.def.dom;
    if (!dom) continue;
    const specs: [string, { exists?: string; text?: string; attributes?: Record<string, string> }][] =
      typeof dom === "string" || Array.isArray(dom)
        ? asArray(dom).map((sel) => [sel, { exists: "" }])
        : Object.entries(dom);
    for (const [selector, spec] of specs) {
      const attrPatterns = Object.entries(spec.attributes ?? {})
        .map(([attr, raw]) => [attr, parsePattern(raw)] as const)
        .filter((x): x is readonly [string, Pattern] => x[1] !== null);
      const textPattern = spec.text !== undefined ? parsePattern(spec.text) : null;
      const exists = spec.exists !== undefined || (!attrPatterns.length && !textPattern && !spec.text);
      const bufferKey = `${tech.name}::${selector}`;
      try {
        rewriter = rewriter.on(selector, {
          element(el) {
            if (exists) record(hits, tech.name, { re: /(?:)/, confidence: 100 }, [""] as unknown as RegExpMatchArray);
            for (const [attr, pattern] of attrPatterns) {
              const value = el.getAttribute(attr);
              if (value === null) continue;
              const m = value.match(pattern.re);
              if (m) record(hits, tech.name, pattern, m);
            }
          },
          text(chunk) {
            if (!textPattern) return;
            const buf = textBuffers.get(bufferKey) ?? { name: tech.name, pattern: textPattern, text: "" };
            if (buf.text.length < 5000) buf.text += chunk.text;
            textBuffers.set(bufferKey, buf);
          },
        });
        handlers++;
      } catch {
        // Selector not supported by HTMLRewriter (e.g. :has()) — skip it.
      }
    }
  }
  if (!handlers) return;
  await rewriter.transform(new Response(html)).arrayBuffer();
  for (const { name, pattern, text } of textBuffers.values()) {
    const m = text.match(pattern.re);
    if (m) record(hits, name, pattern, m);
  }
}

export interface StackInput {
  page: PageData;
  fetched: Pick<FetchedPage, "headers" | "setCookies" | "finalUrl">;
}

/** `builtinOnly` uses just the small curated rule set (cheap enough for secondary pages). */
export async function detectStack({ page, fetched }: StackInput, opts: { builtinOnly?: boolean } = {}): Promise<Tech[]> {
  const all = compiled(opts.builtinOnly);
  const techs = [...all.values()];
  const hits = new Map<string, Hit>();

  const html = page.html.length > 1_000_000 ? page.html.slice(0, 1_000_000) : page.html;
  const scriptSrcs = page.scripts.map((s) => s.src).filter((s): s is string => Boolean(s));
  const inline = page.scripts
    .map((s) => s.inline ?? "")
    .join("\n")
    .slice(0, 500_000);
  const metas = new Map<string, string[]>();
  for (const m of page.metas) {
    for (const key of [m.name, m.property]) {
      if (!key) continue;
      metas.set(key, [...(metas.get(key) ?? []), m.content]);
    }
  }
  const headers = fetched.headers;
  const cookies = parseCookies(fetched.setCookies);

  for (const tech of techs) {
    testAll(hits, tech.name, tech.html, [html]);
    testAll(hits, tech.name, tech.text, [page.text]);
    testAll(hits, tech.name, tech.scriptSrc, scriptSrcs);
    testAll(hits, tech.name, tech.scripts, [inline]);
    testAll(hits, tech.name, tech.url, [fetched.finalUrl]);
    for (const [key, patterns] of tech.meta) {
      const values = metas.get(key);
      if (values) testAll(hits, tech.name, patterns, values);
    }
    for (const [key, patterns] of tech.headers) {
      const value = headers[key];
      if (value !== undefined) testAll(hits, tech.name, patterns, [value]);
    }
    for (const [key, patterns] of tech.cookies) {
      const value = cookies[key];
      if (value !== undefined) testAll(hits, tech.name, patterns, [value]);
    }
  }

  await matchDom(html, techs, hits);
  return resolve(hits, all);
}

function resolve(hits: Map<string, Hit>, all: Map<string, CompiledTech>): Tech[] {

  // implies (transitively)
  const queue = [...hits.keys()];
  while (queue.length) {
    const name = queue.shift() as string;
    for (const raw of asArray(all.get(name)?.def.implies)) {
      const [implied, ...attrs] = raw.split("\\;");
      const conf = Number(attrs.find((a) => a.startsWith("confidence:"))?.slice(11) ?? 100);
      if (!all.has(implied)) continue;
      const existing = hits.get(implied);
      if (!existing) {
        hits.set(implied, { confidence: conf });
        queue.push(implied);
      }
    }
  }

  const detectedCats = () => {
    const s = new Set<number>();
    for (const n of hits.keys()) all.get(n)?.def.cats.forEach((c) => s.add(c));
    return s;
  };

  for (const name of [...hits.keys()]) {
    const def = all.get(name)?.def;
    if (!def) continue;
    const requires = asArray(def.requires);
    if (requires.length && !requires.some((r) => hits.has(r))) hits.delete(name);
  }
  const cats = detectedCats();
  for (const name of [...hits.keys()]) {
    const req = all.get(name)?.def.requiresCategory;
    if (req === undefined) continue;
    const list = Array.isArray(req) ? req : [req];
    if (!list.some((c) => cats.has(c))) hits.delete(name);
  }
  for (const name of [...hits.keys()]) {
    for (const ex of asArray(all.get(name)?.def.excludes)) hits.delete(ex);
  }

  return [...hits.entries()]
    .filter(([, h]) => h.confidence >= 50)
    .map(([name, h]) => {
      const def = all.get(name)?.def;
      return {
        name,
        categories: (def?.cats ?? []).map(categoryName),
        version: h.version,
        confidence: h.confidence,
        website: def?.website,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Union of several detections, keeping the highest confidence per technology. */
export function mergeStacks(...stacks: Tech[][]): Tech[] {
  const out = new Map<string, Tech>();
  for (const t of stacks.flat()) {
    const prev = out.get(t.name);
    if (!prev || t.confidence > prev.confidence) out.set(t.name, { ...t, version: t.version ?? prev?.version });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function hasCategory(stack: Tech[], category: string): Tech[] {
  return stack.filter((t) => t.categories.includes(category));
}
