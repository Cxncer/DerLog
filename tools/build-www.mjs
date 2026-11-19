// Copies the files DerLog needs into www/ for static hosting or a Capacitor shell.
import { cp, mkdir, rm, stat } from "node:fs/promises";

const FILES = [
  "DerLog-v19.html",
  "manifest.webmanifest",
  "sw.js",
  "icon-192.png",
  "icon-512.png"
];

await rm("www", { recursive: true, force: true });
await mkdir("www", { recursive: true });

for (const file of FILES) {
  await stat(file);
  await cp(file, `www/${file}`);
}
// Capacitor serves www/index.html; the hosted site gets the same entry page.
await cp("DerLog-v19.html", "www/index.html");

console.log(`www/ ready: ${FILES.length + 1} files`);
