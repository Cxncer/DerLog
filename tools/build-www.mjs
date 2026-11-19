// Builds www/: the self-contained app bundle that Capacitor packages into the APK.
// Everything the UI needs (React, Tailwind, Leaflet, PDF.js, fonts) is local, so
// the app starts and works with no network. Only the optional OCR reader still
// pulls its library from a CDN, because its model files need a download anyway.
import { readFile, writeFile, mkdir, rm, cp } from "node:fs/promises";
import { build } from "esbuild";

const SRC = "DerLog-v19.html";
const OUT = "www";

const html = await readFile(SRC, "utf8");

/* ---------------------------------------------------------------- 1. app bundle */
const openTag = '<script type="text/babel">';
const start = html.indexOf(openTag);
const end = html.indexOf("</script>", start);
if (start < 0 || end < 0) throw new Error(`${SRC}: inline app script not found`);

const appSource = html
  .slice(start + openTag.length, end)
  .split("https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js")
  .join("./assets/pdf.worker.min.js");

const entry = `import React from "react";
import * as ReactDOMClient from "react-dom/client";
window.React = React;
window.ReactDOM = ReactDOMClient;
${appSource}
`;

await rm(OUT, { recursive: true, force: true });
await mkdir(`${OUT}/assets`, { recursive: true });

await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: "jsx", sourcefile: "app.jsx" },
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2020"],
  outfile: `${OUT}/assets/app.js`,
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning"
});

/* ---------------------------------------------------------------- 2. index.html */
let page = html.slice(0, start) + '<script src="./assets/app.js"></script>' + html.slice(end + "</script>".length);

const cdnStart = page.indexOf('<script src="https://cdn.tailwindcss.com"></script>');
const styleAt = page.indexOf("<style>", cdnStart);
if (cdnStart < 0 || styleAt < 0) throw new Error(`${SRC}: CDN block not found`);

page =
  page.slice(0, cdnStart) +
  `  <script src="./assets/tailwind.js"></script>
  <script src="./assets/leaflet.js"></script>
  <script src="./assets/pdf.min.js"></script>
  <link rel="stylesheet" href="./assets/leaflet.css" />
  <link rel="stylesheet" href="./assets/fonts.css" />
  <script src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"></script>
` +
  page.slice(styleAt);

// The APK shell always fills the screen: the OS draws the real status bar there.
// The flag lives on <html> because the app rewrites body.className for its theme.
page = page.replace('<html lang="en">', '<html lang="en" class="native-shell">');

await writeFile(`${OUT}/index.html`, page);

/* ---------------------------------------------------------------- 3. local assets */
const COPIES = [
  ["vendor/tailwind-play.js", "assets/tailwind.js"],
  ["vendor/fonts.css", "assets/fonts.css"],
  ["vendor/leaflet/leaflet.js", "assets/leaflet.js"],
  ["vendor/leaflet/leaflet.css", "assets/leaflet.css"],
  ["vendor/leaflet/images", "assets/images"],
  ["vendor/pdfjs/pdf.min.js", "assets/pdf.min.js"],
  ["vendor/pdfjs/pdf.worker.min.js", "assets/pdf.worker.min.js"],
  ["icon-192.png", "icon-192.png"],
  ["icon-512.png", "icon-512.png"],
  ["manifest.webmanifest", "manifest.webmanifest"]
];

for (const [from, to] of COPIES) await cp(from, `${OUT}/${to}`, { recursive: true });
await cp("vendor/fonts", `${OUT}/assets/fonts`, { recursive: true });

console.log(`${OUT}/ ready — offline app bundle`);
