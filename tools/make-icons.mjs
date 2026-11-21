// Builds every icon/splash source image from assets/logo.svg (black background, white mark).
// `npm run icons` then runs `capacitor-assets generate`, which writes each Android mipmap size.
import { mkdir, readFile } from "node:fs/promises";
import sharp from "sharp";

const svg = await readFile("assets/logo.svg", "utf8");
// Transparent-background copy of the mark for the adaptive-icon foreground layer.
const markOnly = svg.replace(/<rect[^>]*\/>\s*/, "");
// Android crops adaptive icons to a circle/squircle: keep the mark inside the centre 66%.
// Widening the viewBox shrinks the mark so it sits inside that safe zone.
const foreground = markOnly.replace('viewBox="0 0 1024 1024"', 'viewBox="-192 -192 1408 1408"');

await mkdir("resources", { recursive: true });
const render = (source, size) => sharp(Buffer.from(source), { density: 384 }).resize(size, size).png();

await render(svg, 1024).toFile("resources/icon.png");
await render(foreground, 1024).toFile("resources/icon-foreground.png");
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: "#000000" } })
  .png().toFile("resources/icon-background.png");

const badge = await render(svg, 720).toBuffer();
await sharp({ create: { width: 2732, height: 2732, channels: 4, background: "#000000" } })
  .composite([{ input: badge, gravity: "center" }])
  .png()
  .toFile("resources/splash.png");

// Web/PWA icons shipped in the repo root.
await render(svg, 512).toFile("icon-512.png");
await render(svg, 192).toFile("icon-192.png");
console.log("icons ready: resources/*, icon-192.png, icon-512.png");
