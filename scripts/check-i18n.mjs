// Fails the build when ko.json and en.json do not have the same keys and placeholders.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "i18n");
const load = (lang) => JSON.parse(readFileSync(join(dir, `${lang}.json`), "utf8"));
const ko = load("ko");
const en = load("en");
const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

const problems = [];
for (const key of Object.keys(ko)) {
  if (!(key in en)) problems.push(`en.json is missing "${key}"`);
  else if (holes(ko[key]) !== holes(en[key])) problems.push(`placeholders differ for "${key}": ko {${holes(ko[key])}} en {${holes(en[key])}}`);
}
for (const key of Object.keys(en)) {
  if (!(key in ko)) problems.push(`ko.json is missing "${key}"`);
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`i18n ok: ${Object.keys(ko).length} keys`);
