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
  if (!path.endsWith(".test.ts") && path.startsWith("src") && (text.includes("XAI_API_KEY") || text.includes("api.x.ai") || text.includes("x-rsi-passcode"))) {
    failures.push(`${path}: the browser must not hold an xAI key or a passcode.`);
  }
}
const html = await readFile("index.html", "utf8");
if (!html.includes("Content-Security-Policy")) failures.push("index.html: missing Content-Security-Policy.");
if (!html.includes("https://query1.finance.yahoo.com")) failures.push("index.html: CSP is missing the Yahoo connect source.");
if (!html.includes("https://raw.githubusercontent.com")) failures.push("index.html: CSP is missing the snapshot connect source.");
if (!html.includes("https://ojntnbaakfowmnrsetbb.supabase.co")) failures.push("index.html: CSP is missing the RSI server connect source.");
if (html.includes("https://api.x.ai")) failures.push("index.html: the browser must not call xAI. The key stays on the server.");
if (!html.includes("font-src 'self'")) failures.push("index.html: fonts must stay self-hosted.");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`lint ok (${paths.length} files)`);
