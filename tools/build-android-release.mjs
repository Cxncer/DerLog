// Builds www/, syncs it into the Android project and assembles a release-signed APK.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ROOT = process.cwd();
const ANDROID = join(ROOT, "android");
const STUDIO_JBR = "C:/Program Files/Android/Android Studio/jbr";
const javaHome = existsSync(join(STUDIO_JBR, "bin", "java.exe"))
  ? STUDIO_JBR
  : process.env.JAVA_HOME || "";

const run = (command, args, cwd = ROOT) => {
  console.log(`> ${command} ${args.join(" ")}`);
  const needsShell = process.platform === "win32" && /\.(bat|cmd)$/i.test(command);
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: needsShell,
    env: { ...process.env, JAVA_HOME: javaHome }
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

if (!existsSync(join(ROOT, "signing", "keystore.properties"))) {
  console.error("No signing setup found. Run: node tools/setup-android-release.mjs");
  process.exit(1);
}
if (!existsSync(ANDROID)) {
  console.error("android/ not found. Run: npx cap add android");
  process.exit(1);
}

run(process.execPath, ["tools/build-www.mjs"]);
run(process.platform === "win32" ? "npx.cmd" : "npx", ["cap", "sync", "android"]);
run(join(ANDROID, "gradlew.bat"), ["assembleRelease", "--no-daemon"], ANDROID);

console.log("\nRelease APK:");
console.log(join(ANDROID, "app", "build", "outputs", "apk", "release", "app-release.apk"));
