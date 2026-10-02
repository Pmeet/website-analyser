import type { Env, FetchedPage } from "../types";
import { BROWSER_HEADERS, fetchWithTimeout, headersToObject, readTextCapped } from "../lib/http";

const BLOCK_MARKERS = [
  /<title>\s*just a moment/i,
  /cf-chl-|challenge-platform/i,
  /attention required!?\s*\|\s*cloudflare/i,
  /px-captcha|perimeterx/i,
  /datadome/i,
  /<title>\s*access denied/i,
  /sucuri website firewall/i,
  /incapsula incident/i,
];

export async function fetchPage(url: string, timeoutMs = 15_000): Promise<FetchedPage> {
  const start = Date.now();
  const res = await fetchWithTimeout(url, { headers: BROWSER_HEADERS, redirect: "follow" }, timeoutMs);
  const contentType = res.headers.get("content-type") ?? "";
  const html = contentType && !/html|xml|text\/plain/i.test(contentType) ? "" : await readTextCapped(res);
  const setCookies =
    (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ??
    (res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : []);
  return {
    requestedUrl: url,
    finalUrl: res.url || url,
    status: res.status,
    headers: headersToObject(res.headers),
    setCookies,
    html,
    ms: Date.now() - start,
    redirects: res.redirected ? 1 : 0,
    blocked: isBlocked(res.status, html),
    usedBrowserRendering: false,
  };
}

export function isBlocked(status: number, html: string): boolean {
  if (status === 401 || status === 407) return true;
  const head = html.slice(0, 20_000);
  if ([403, 429, 503].includes(status)) return true;
  return BLOCK_MARKERS.some((re) => re.test(head)) && head.length < 15_000;
}

/** Heuristic: the server sent an app shell with almost no readable content. */
export function looksJsRendered(html: string, visibleText: string): boolean {
  if (visibleText.length > 400) return false;
  const scriptCount = (html.match(/<script\b/gi) ?? []).length;
  const appShell = /<div[^>]+id=["'](root|app|__next|__nuxt|svelte|q-app)["'][^>]*>\s*<\/div>/i.test(html);
  return appShell || scriptCount >= 3;
}

export function browserRenderingConfigured(env: Env): boolean {
  return Boolean(env.CF_ACCOUNT_ID && env.CF_API_TOKEN);
}

/** Cloudflare Browser Rendering REST API: returns fully rendered HTML. */
export async function renderWithBrowser(env: Env, url: string): Promise<string> {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/browser-rendering/content`;
  const res = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: { authorization: `Bearer ${env.CF_API_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        url,
        gotoOptions: { waitUntil: "networkidle2", timeout: 30_000 },
        rejectResourceTypes: ["image", "media", "font"],
      }),
    },
    45_000,
  );
  const body = (await res.json().catch(() => null)) as { success?: boolean; result?: string; errors?: { message: string }[] } | null;
  if (!res.ok || !body?.success || typeof body.result !== "string") {
    throw new Error(`Browser Rendering failed (${res.status}): ${body?.errors?.map((e) => e.message).join("; ") ?? "no result"}`);
  }
  return body.result;
}
