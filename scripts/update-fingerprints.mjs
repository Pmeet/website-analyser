#!/usr/bin/env node
// Downloads the community-maintained Wappalyzer fingerprints (github.com/enthec/webappanalyzer),
// keeps only the categories and fields the analyser can evaluate server-side, and writes
// src/stack/fingerprints.generated.json. The built-in rules in src/stack/rules.ts work without it.
//
// NOTE: the webappanalyzer dataset is GPL-3.0. Bundling it into your deployment is your call;
// this project's own code is Apache-2.0.
//
// Usage: npm run fingerprints [-- --ref main] [-- --all-categories]
import { writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const ref = args.includes("--ref") ? args[args.indexOf("--ref") + 1] : "main";
const allCategories = args.includes("--all-categories");
const base = `https://raw.githubusercontent.com/enthec/webappanalyzer/${ref}/src`;

// Keep in sync with KEPT_CATEGORY_IDS in src/stack/categories.ts.
const KEPT = new Set([1, 5, 6, 10, 11, 12, 18, 22, 27, 31, 32, 36, 41, 42, 51, 52, 53, 57, 62, 67, 72, 73, 75, 77, 80, 87, 88, 90, 93, 104, 110, 112]);
const FIELDS = ["cats", "website", "html", "text", "scriptSrc", "scripts", "url", "meta", "headers", "cookies", "dom", "implies", "requires", "requiresCategory", "excludes"];

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

const categoriesRaw = await getJson(`${base}/categories.json`);
const categories = Object.fromEntries(Object.entries(categoriesRaw).map(([id, c]) => [id, c.name]));

const letters = ["_", ..."abcdefghijklmnopqrstuvwxyz"];
const technologies = {};
let total = 0;
for (const letter of letters) {
  const techs = await getJson(`${base}/technologies/${letter}.json`);
  for (const [name, def] of Object.entries(techs)) {
    total++;
    if (!allCategories && !def.cats?.some((c) => KEPT.has(c))) continue;
    const slim = {};
    for (const f of FIELDS) if (def[f] !== undefined) slim[f] = def[f];
    // Skip techs that can only be detected via JS globals / DNS / XHR (not evaluable here).
    const evaluable = ["html", "text", "scriptSrc", "scripts", "url", "meta", "headers", "cookies", "dom", "implies"].some((f) => slim[f] !== undefined);
    if (!evaluable && !def.requires) continue;
    technologies[name] = slim;
  }
}

const out = new URL("../src/stack/fingerprints.generated.json", import.meta.url);
await writeFile(out, JSON.stringify({ source: `enthec/webappanalyzer@${ref}`, generatedAt: new Date().toISOString(), categories, technologies }));
console.log(`Kept ${Object.keys(technologies).length} of ${total} technologies → ${out.pathname}`);
