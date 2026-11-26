// Fails the build when the screen texts are not all in the i18n tables:
// 1. ko.json and en.json have the same keys and the same placeholders;
// 2. no Hangul outside comments in src/**/*.ts, index.html and mini.html (screen text goes through t() or data-t);
// 3. every literal t("key") in src/**/*.ts and every data-t / data-t-title / data-t-aria /
//    data-t-placeholder key in index.html exists in ko.json.
// Dynamic keys (t(`state.${state}`)) are not checked here.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "src", "i18n");
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

const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3]/;

/**
 * TypeScript source without its comments; strings, template literals and regex literals stay.
 * Newlines inside comments are kept so line numbers still match.
 */
function stripTsComments(text) {
  let out = "";
  let i = 0;
  // Last significant character, to tell a regex literal from a division
  let last = "";
  const templateDepth = [];
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, "");
      i = stop;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
      last = c;
      continue;
    }
    if (c === "`" || (c === "}" && templateDepth.length && templateDepth[templateDepth.length - 1] === 0)) {
      if (c === "}") templateDepth.pop();
      let j = i + 1;
      while (j < text.length && text[j] !== "`" && !(text[j] === "$" && text[j + 1] === "{")) j += text[j] === "\\" ? 2 : 1;
      if (text[j] === "$") {
        templateDepth.push(0);
        out += text.slice(i, j + 2);
        i = j + 2;
      } else {
        out += text.slice(i, j + 1);
        i = j + 1;
      }
      last = "`";
      continue;
    }
    if (c === "/" && (last === "" || "(,=:[!&|?{};+-*%<>~^".includes(last) || /\breturn$/.test(out.trimEnd()))) {
      let j = i + 1;
      let inClass = false;
      while (j < text.length && text[j] !== "\n") {
        if (text[j] === "\\") j += 2;
        else if (text[j] === "[") (inClass = true), j++;
        else if (text[j] === "]") (inClass = false), j++;
        else if (text[j] === "/" && !inClass) break;
        else j++;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
      last = "/";
      continue;
    }
    if (templateDepth.length) {
      if (c === "{") templateDepth[templateDepth.length - 1]++;
      else if (c === "}") templateDepth[templateDepth.length - 1]--;
    }
    out += c;
    if (!/\s/.test(c)) last = c;
    i++;
  }
  return out;
}

function listTs(folder) {
  const files = [];
  for (const name of readdirSync(folder)) {
    const full = join(folder, name);
    if (statSync(full).isDirectory()) files.push(...listTs(full));
    else if (name.endsWith(".ts")) files.push(full);
  }
  return files;
}

function hangulLines(code, file) {
  code.split("\n").forEach((line, n) => {
    if (HANGUL.test(line)) problems.push(`${file}:${n + 1}: Hangul outside a comment (use t() and the i18n tables): ${line.trim().slice(0, 80)}`);
  });
}

const used = new Map();
const use = (key, where) => {
  if (!used.has(key)) used.set(key, where);
};

for (const full of listTs(join(root, "src"))) {
  const file = relative(root, full).replace(/\\/g, "/");
  const code = stripTsComments(readFileSync(full, "utf8"));
  hangulLines(code, file);
  for (const m of code.matchAll(/(?<![\w$.])t\(\s*(["'`])([^"'`$\n]+)\1/g)) use(m[2], file);
  // t(cond ? "a" : "b")
  for (const m of code.matchAll(/(?<![\w$.])t\(\s*[^"'`\n?;]*\?\s*"([^"\n]+)"\s*:\s*"([^"\n]+)"\s*[,)]/g)) {
    use(m[1], file);
    use(m[2], file);
  }
}

for (const page of ["index.html", "mini.html"]) {
  const html = readFileSync(join(root, page), "utf8").replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ""));
  hangulLines(html, page);
  for (const m of html.matchAll(/\sdata-t(?:-title|-aria|-placeholder)?="([^"]+)"/g)) use(m[1], page);
}

for (const [key, where] of used) {
  if (!(key in ko)) problems.push(`${where}: key "${key}" is not in ko.json`);
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`i18n ok: ${Object.keys(ko).length} keys, ${used.size} literal keys used in src, index.html and mini.html`);
