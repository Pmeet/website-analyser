import type { EmailResult } from "../types";
import { fetchWithTimeout } from "../lib/http";

type DnsAnswer = { name: string; type: number; TTL: number; data: string };

/** Cloudflare DNS-over-HTTPS (JSON API). */
export async function dohQuery(name: string, type: "TXT" | "MX" | "A" | "NS" | "CNAME"): Promise<DnsAnswer[]> {
  const res = await fetchWithTimeout(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
    { headers: { accept: "application/dns-json" } },
    6_000,
  );
  if (!res.ok) throw new Error(`DoH ${type} ${name}: HTTP ${res.status}`);
  const body = (await res.json()) as { Status: number; Answer?: DnsAnswer[] };
  // 0 = NOERROR, 3 = NXDOMAIN (treat as empty)
  if (body.Status !== 0 && body.Status !== 3) throw new Error(`DoH ${type} ${name}: status ${body.Status}`);
  const typeCode = { A: 1, NS: 2, CNAME: 5, MX: 15, TXT: 16 }[type];
  return (body.Answer ?? []).filter((a) => a.type === typeCode);
}

/** TXT data arrives as one or more quoted chunks: "v=spf1 include:a" "include:b -all" */
export function joinTxt(data: string): string {
  const chunks = data.match(/"((?:[^"\\]|\\.)*)"/g);
  if (!chunks) return data;
  return chunks.map((c) => c.slice(1, -1).replace(/\\"/g, '"')).join("");
}

const MX_PROVIDERS: [RegExp, string][] = [
  [/google\.com\.?$|googlemail\.com\.?$/i, "Google Workspace"],
  [/mail\.protection\.outlook\.com\.?$/i, "Microsoft 365"],
  [/zoho\.(com|eu|in)\.?$/i, "Zoho Mail"],
  [/protonmail\.ch\.?$/i, "Proton Mail"],
  [/mimecast\.com\.?$/i, "Mimecast"],
  [/pphosted\.com\.?$/i, "Proofpoint"],
  [/secureserver\.net\.?$/i, "GoDaddy"],
  [/ovh\.net\.?$/i, "OVH"],
  [/ionos\.|1and1\./i, "IONOS"],
  [/mx\.cloudflare\.net\.?$/i, "Cloudflare Email Routing"],
  [/messagingengine\.com\.?$/i, "Fastmail"],
  [/icloud\.com\.?$/i, "iCloud"],
  [/yandex\./i, "Yandex"],
  [/hostinger\./i, "Hostinger"],
];

export async function checkEmail(domain: string): Promise<EmailResult> {
  const [mxAnswers, txtAnswers, dmarcAnswers] = await Promise.all([
    dohQuery(domain, "MX"),
    dohQuery(domain, "TXT"),
    dohQuery(`_dmarc.${domain}`, "TXT"),
  ]);

  const mx = mxAnswers
    .map((a) => a.data.split(/\s+/))
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map((parts) => (parts[1] ?? parts[0]).replace(/\.$/, "").toLowerCase());
  const mxProvider = MX_PROVIDERS.find(([re]) => mx.some((h) => re.test(h)))?.[1] ?? null;

  const spfRecords = txtAnswers.map((a) => joinTxt(a.data)).filter((t) => /^v=spf1\b/i.test(t.trim()));
  const spfRecord = spfRecords[0] ?? null;
  const allQualifier = spfRecord?.match(/\s([+~?-]?)all\b/i);

  const dmarcRecord = dmarcAnswers.map((a) => joinTxt(a.data)).find((t) => /^v=DMARC1\b/i.test(t.trim())) ?? null;
  const policy = dmarcRecord?.match(/\bp=\s*(\w+)/i)?.[1]?.toLowerCase() ?? null;

  // DKIM selectors are arbitrary; probe a few common ones based on the mail provider.
  const selectors =
    mxProvider === "Google Workspace"
      ? ["google"]
      : mxProvider === "Microsoft 365"
        ? ["selector1", "selector2"]
        : ["default", "k1", "s1"];
  const dkimFound: string[] = [];
  await Promise.all(
    selectors.map(async (sel) => {
      // DoH follows CNAMEs (common for DKIM delegated to an ESP) and returns the final TXT.
      const answers = await dohQuery(`${sel}._domainkey.${domain}`, "TXT").catch(() => []);
      if (answers.some((a) => /p=/i.test(joinTxt(a.data)))) dkimFound.push(sel);
    }),
  );

  const result: EmailResult = {
    domain,
    mx,
    mxProvider,
    spf: {
      record: spfRecord,
      count: spfRecords.length,
      allQualifier: allQualifier ? allQualifier[1] || "+" : null,
    },
    dmarc: { record: dmarcRecord, policy, rua: Boolean(dmarcRecord && /\brua=/i.test(dmarcRecord)) },
    dkim: { selectorsFound: dkimFound.sort(), selectorsTried: selectors },
    score: 0,
  };
  result.score = scoreEmail(result);
  return result;
}

export function scoreEmail(e: EmailResult): number {
  if (!e.mx.length) return e.spf.record ? 60 : 40;
  let s = 0;
  if (e.spf.record && e.spf.count === 1) s += e.spf.allQualifier === "-" || e.spf.allQualifier === "~" ? 40 : 25;
  if (e.dmarc.record) s += e.dmarc.policy === "reject" || e.dmarc.policy === "quarantine" ? 45 : 30;
  if (e.dkim.selectorsFound.length) s += 15;
  else if (e.spf.record && e.dmarc.record) s += 10; // DKIM likely present under an unknown selector
  return Math.min(100, s);
}
