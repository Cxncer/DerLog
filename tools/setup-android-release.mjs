// One-time release signing setup: keystore + properties + Gradle signingConfig.
// Safe to re-run; an existing keystore is never overwritten.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = process.cwd();
const SIGNING_DIR = join(ROOT, "signing");
const KEYSTORE = join(SIGNING_DIR, "derlog-release.jks");
const PROPS = join(SIGNING_DIR, "keystore.properties");
const GRADLE = join(ROOT, "android", "app", "build.gradle");
const ALIAS = "derlog";

const STUDIO_JBR = "C:/Program Files/Android/Android Studio/jbr";
const javaHome = existsSync(join(STUDIO_JBR, "bin", "keytool.exe"))
  ? STUDIO_JBR
  : process.env.JAVA_HOME || process.env.JDK_HOME || "";

if (!existsSync(GRADLE)) {
  console.error("android/app/build.gradle not found. Run: npx cap add android");
  process.exit(1);
}

mkdirSync(SIGNING_DIR, { recursive: true });

if (!existsSync(KEYSTORE)) {
  const password = randomBytes(18).toString("hex");
  const keytool = javaHome ? join(javaHome, "bin", "keytool.exe") : "keytool";
  execFileSync(
    keytool,
    [
      "-genkeypair", "-v",
      "-keystore", KEYSTORE,
      "-alias", ALIAS,
      "-keyalg", "RSA",
      "-keysize", "2048",
      "-validity", "10000",
      "-storepass", password,
      "-keypass", password,
      "-dname", "CN=DerLog, O=DerLog, C=KH"
    ],
    { stdio: "inherit" }
  );
  writeFileSync(
    PROPS,
    [
      `storeFile=${KEYSTORE.replace(/\\/g, "/")}`,
      `storePassword=${password}`,
      `keyAlias=${ALIAS}`,
      `keyPassword=${password}`,
      ""
    ].join("\n")
  );
  console.log(`\nKeystore created: ${KEYSTORE}`);
  console.log(`Store password is in ${PROPS} — back up both files somewhere safe.`);
} else {
  console.log(`Keystore already exists: ${KEYSTORE}`);
}

writeFileSync(
  join(ROOT, "android", "local.properties"),
  `sdk.dir=${join(homedir(), "AppData", "Local", "Android", "Sdk").replace(/\\/g, "/")}\n`
);

if (existsSync(join(STUDIO_JBR, "bin", "java.exe"))) {
  const gradleProps = join(ROOT, "android", "gradle.properties");
  const current = existsSync(gradleProps) ? readFileSync(gradleProps, "utf8") : "";
  if (!current.includes("org.gradle.java.home")) {
    writeFileSync(gradleProps, current.replace(/\s*$/, "\n") + `org.gradle.java.home=${STUDIO_JBR}\n`);
  }
}

let gradle = readFileSync(GRADLE, "utf8");

if (!gradle.includes("derlog-keystore.properties")) {
  gradle = gradle.replace(
    "android {",
    `def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file('../signing/keystore.properties')
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

android {`
  );
  gradle = gradle.replace(
    "    buildTypes {",
    `    signingConfigs {
        release {
            if (keystorePropertiesFile.exists()) {
                storeFile file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            }
        }
    }
    buildTypes {`
  );
  gradle = gradle.replace(
    `        release {
            minifyEnabled false`,
    `        release {
            signingConfig signingConfigs.release
            minifyEnabled false`
  );
  writeFileSync(GRADLE, gradle);
  console.log("Added release signingConfig to android/app/build.gradle");
} else {
  console.log("Signing config already present");
}

const props = readFileSync(PROPS, "utf8");
console.log(`Ready. Keystore: ${resolve(KEYSTORE)} (alias ${ALIAS})`);
console.log(`Properties: ${PROPS} (${props.split("\n").length - 1} entries)`);
