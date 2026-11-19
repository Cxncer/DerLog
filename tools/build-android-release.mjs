// Builds www/, syncs it into the Android project and assembles a release-signed APK.
// Capacitor and Gradle are started through node/java directly so the build also
// works from a project path that contains spaces (no cmd.exe quoting involved).
import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ROOT = process.cwd();
const ANDROID = join(ROOT, "android");
const STUDIO_JBR = "C:/Program Files/Android/Android Studio/jbr";

// Prefer the project-local JDK 21 (.toolchain/): Android Studio's bundled JDK 25
// is too new for AGP 8.7's lint step and fails release builds.
function projectJdk() {
  const dir = join(ROOT, ".toolchain");
  if (!existsSync(dir)) return "";
  const found = readdirSync(dir).find(
    (name) => /^jdk-?21/i.test(name) && existsSync(join(dir, name, "bin", "java.exe"))
  );
  return found ? join(dir, found) : "";
}

const javaHome =
  projectJdk() ||
  (existsSync(join(STUDIO_JBR, "bin", "java.exe")) ? STUDIO_JBR : process.env.JAVA_HOME || "");
const java = javaHome ? join(javaHome, "bin", "java.exe") : "java";

const run = (command, args, cwd = ROOT) => {
  console.log(`> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, JAVA_HOME: javaHome || process.env.JAVA_HOME }
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
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

run(process.execPath, [join(ROOT, "tools", "build-www.mjs")]);
run(process.execPath, [join(ROOT, "node_modules", "@capacitor", "cli", "bin", "capacitor"), "sync", "android"]);
run(
  java,
  [
    "-classpath",
    join(ANDROID, "gradle", "wrapper", "gradle-wrapper.jar"),
    "org.gradle.wrapper.GradleWrapperMain",
    "assembleRelease"
  ],
  ANDROID
);

console.log("\nRelease APK:");
console.log(join(ANDROID, "app", "build", "outputs", "apk", "release", "app-release.apk"));
