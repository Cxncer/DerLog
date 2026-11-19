// Builds the icon/splash source images consumed by `npx capacitor-assets generate`,
// which then writes every android mipmap size. Run after changing icon-512.png.
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const BG = "#040811";

await mkdir("resources", { recursive: true });

await sharp("icon-512.png")
  .resize(1024, 1024, { kernel: "lanczos3" })
  .png()
  .toFile("resources/icon.png");

const badge = await sharp("icon-512.png").resize(720, 720, { kernel: "lanczos3" }).png().toBuffer();

await sharp({ create: { width: 2732, height: 2732, channels: 4, background: BG } })
  .composite([{ input: badge, gravity: "center" }])
  .png()
  .toFile("resources/splash.png");

console.log("resources/icon.png + resources/splash.png ready");
