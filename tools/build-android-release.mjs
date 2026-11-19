// Builds www/, syncs it into the Android project and assembles a release-signed APK.
// Capacitor and Gradle are started through node/java directly so the build also
// works from a project path that contains spaces (no cmd.exe quoting involved).
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

// android/ is generated (and kept out of git), so the native sign-in sources live in
// native/google-auth/ and are copied into the project on every release build. The same step
// re-adds the Play services dependency if android/ was recreated with `cap add android`.
const NATIVE_JAVA = join(ROOT, "native", "google-auth");
if (existsSync(NATIVE_JAVA)) {
  const appJava = join(ANDROID, "app", "src", "main", "java", "com", "derlog", "app");
  mkdirSync(appJava, { recursive: true });
  for (const file of ["GoogleAuthPlugin.java", "MainActivity.java"]) {
    cpSync(join(NATIVE_JAVA, file), join(appJava, file));
  }
  const gradleFile = join(ANDROID, "app", "build.gradle");
  if (existsSync(gradleFile)) {
    let gradle = readFileSync(gradleFile, "utf8");
    const dep = 'implementation "com.google.android.gms:play-services-auth:21.2.0"';
    if (!gradle.includes(dep)) {
      gradle = gradle.replace(
        "    implementation project(':capacitor-cordova-android-plugins')",
        `    implementation project(':capacitor-cordova-android-plugins')\n    ${dep}`
      );
      writeFileSync(gradleFile, gradle);
      console.log("Added play-services-auth for native Google sign-in");
    }
  }
}

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
