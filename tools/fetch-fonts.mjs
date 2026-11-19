// Downloads the Google font files the app uses into vendor/fonts/ and rewrites
// vendor/gfonts-raw.css to point at them, so the app renders with no network.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename } from "node:path";

const raw = readFileSync("vendor/gfonts-raw.css", "utf8");
const urls = [...new Set(raw.match(/https:\/\/fonts\.gstatic\.com\/[^)]+/g) || [])];
if (!urls.length) throw new Error("No font URLs found in vendor/gfonts-raw.css");

mkdirSync("vendor/fonts", { recursive: true });

let css = raw;
for (const url of urls) {
  const name = basename(new URL(url).pathname);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  writeFileSync(`vendor/fonts/${name}`, Buffer.from(await res.arrayBuffer()));
  css = css.split(url).join(`./fonts/${name}`);
}

writeFileSync("vendor/fonts.css", css);
console.log(`vendor/fonts.css: ${urls.length} woff2 files`);
