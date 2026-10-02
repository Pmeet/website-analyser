import { getDomain, getHostname } from "tldts";
import type { CheckStatus } from "../types";

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 WebsiteAnalyser/0.1";

export const BROWSER_HEADERS: Record<string, string> = {
  "user-agent": USER_AGENT,
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-GB,en;q=0.9",
};

export async function fetchWithTimeout(input: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Accepts "acme.co.uk", "www.acme.co.uk/path", "http://…" and returns a normalised https URL. */
export function normalizeUrl(input: string): string {
  let s = input.trim();
  if (!s) throw new Error("Empty URL");
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  const u = new URL(s);
  if (!u.hostname.includes(".")) throw new Error(`Not a valid hostname: ${u.hostname}`);
  u.hash = "";
  return u.toString();
}

/** Registrable domain: www.shop.acme.co.uk → acme.co.uk */
export function registrableDomain(urlOrHost: string): string {
  const host = getHostname(urlOrHost) ?? urlOrHost;
  return getDomain(host) ?? host.replace(/^www\./, "");
}

export function hostOf(url: string): string {
  return new URL(url).hostname.toLowerCase();
}

export function displayHost(url: string): string {
  return hostOf(url).replace(/^www\./, "");
}

export function sameSite(a: string, b: string): boolean {
  try {
    return registrableDomain(a) === registrableDomain(b);
  } catch {
    return false;
  }
}

export function resolveUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/** Runs a check, records timing and failure without throwing. */
export async function timed<T>(
  checks: Record<string, CheckStatus>,
  name: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  const start = Date.now();
  try {
    const value = await fn();
    checks[name] = { ok: true, ms: Date.now() - start };
    return value;
  } catch (err) {
    checks[name] = { ok: false, ms: Date.now() - start, error: errorMessage(err) };
    return null;
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

export async function readTextCapped(res: Response, maxBytes = 3_000_000): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    if (total >= maxBytes) {
      await reader.cancel();
      break;
    }
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c.subarray(0, Math.min(c.byteLength, total - offset)), offset);
    offset += c.byteLength;
    if (offset >= total) break;
  }
  return new TextDecoder().decode(buf);
}
