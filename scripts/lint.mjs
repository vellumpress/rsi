import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const roots = ["src", "index.html", "public"];
const banned = [
  ["dangerouslySetInnerHTML", "User text must not be written with dangerouslySetInnerHTML."],
  ["innerHTML", "User text must not be written with innerHTML."],
  ["eval(", "eval is not allowed."],
  ["fonts.googleapis.com", "Third-party font hosts are not allowed."],
  ["fonts.gstatic.com", "Third-party font hosts are not allowed."],
];

async function files(path) {
  const stat = await readdir(path, { withFileTypes: true }).catch(() => null);
  if (!stat) return [path];
  const out = [];
  for (const entry of stat) {
    const next = join(path, entry.name);
    if (entry.isDirectory()) out.push(...(await files(next)));
    else if (/\.(ts|tsx|js|mjs|html|css|json|webmanifest)$/.test(entry.name)) out.push(next);
  }
  return out;
}

const paths = (await Promise.all(roots.map((root) => files(root)))).flat();
const failures = [];
for (const path of paths) {
  const text = await readFile(path, "utf8");
  for (const [needle, reason] of banned) {
    if (text.includes(needle)) failures.push(`${path}: ${reason}`);
  }
}
const html = await readFile("index.html", "utf8");
if (!html.includes("Content-Security-Policy")) failures.push("index.html: missing Content-Security-Policy.");
if (!html.includes("https://query1.finance.yahoo.com")) failures.push("index.html: CSP is missing the Yahoo connect source.");
if (!html.includes("https://raw.githubusercontent.com")) failures.push("index.html: CSP is missing the snapshot connect source.");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`lint ok (${paths.length} files)`);
