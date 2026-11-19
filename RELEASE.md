# DerLog Android release build

Project folder: `E:\Vibe Coding\DerLog`
App id: `com.derlog.app` · version 1.23.1 (versionCode 2)

## 1. What `www/` is

`npm run build` compiles `DerLog-v19.html` into a self-contained app bundle:

| Output | Source |
| --- | --- |
| `www/assets/app.js` | the inline JSX script, precompiled by esbuild with React + ReactDOM bundled in (no Babel at runtime) |
| `www/assets/tailwind.js` | `vendor/tailwind-play.js` — Tailwind's JIT engine, so arbitrary/dynamic classes keep working |
| `www/assets/leaflet.*`, `images/` | `vendor/leaflet/` |
| `www/assets/pdf.min.js`, `pdf.worker.min.js` | `vendor/pdfjs/` |
| `www/assets/fonts.css`, `fonts/*.woff2` | `vendor/` (Plus Jakarta Sans + Kantumruy Pro, Latin and Khmer) |
| `www/index.html` | `DerLog-v19.html` with the CDN tags replaced by the local files above |

The bundle also drops the web mock-up chrome: `www/index.html` gets `class="native-shell"`
on `<html>`, which removes the 400×844 phone frame, its rounded corners/shadow and the
fake “9:41 / 5G” row, so the app fills the screen and the real Android status bar is
visible. `@capacitor/status-bar` keeps that bar in step with the theme (`#040811` with
light icons in dark mode and during onboarding, white with dark icons in light mode).
Status-bar classes must not live on `<body>`: the app rewrites `body.className` when the
theme changes.

The APK therefore starts with no network and no CDN. The only remote asset left is the
OCR library (`tesseract.js`), whose model files are a download anyway; if it cannot load,
the ticket scanner shows "Text recognition is unavailable" and manual entry still works.
Trip photos, maps and cloud backup are network features by nature and degrade to the
bundled Wikimedia/Openverse fallback offline.

`DerLog-v19.html` itself is unchanged as a web page: served from the repo root it still
loads the libraries from CDNs.

## 2. Signing files (never committed)

| Path | Purpose |
| --- | --- |
| `signing/derlog-release.jks` | RSA 2048 keystore, alias `derlog`, valid 10,000 days |
| `signing/keystore.properties` | store/key passwords and keystore path |

Back both up. If the keystore is lost, no future build can install over an existing one.

## 3. First-time / after moving the folder

```bash
npm install
npm run android:sign     # node tools/setup-android-release.mjs
```

The script is idempotent:

- creates the keystore only if it is missing
- rewrites `android/local.properties` (`sdk.dir`) and `android/gradle.properties`
  (`org.gradle.java.home`) with absolute paths, so re-run it after moving the project
- adds `signingConfigs.release` to `android/app/build.gradle` once, marked with
  `// derlog-release-signing`
- re-run it any time you recreate `android/` with `npx cap add android` (then put back
  the app id, version numbers and signing block — or just re-run the script and edit
  `namespace`/`applicationId` to `com.derlog.app`)

## 4. Build a release APK

```bash
npm run android:release
```

Steps: `tools/build-www.mjs` → Capacitor `sync android` → Gradle `assembleRelease`
(started through `java -classpath gradle-wrapper.jar`, which survives paths with spaces).

Output: `android\app\build\outputs\apk\release\app-release.apk`

Verify:

```bash
"%LOCALAPPDATA%\Android\Sdk\build-tools\35.0.0\apksigner.bat" verify --print-certs ^
  android\app\build\outputs\apk\release\app-release.apk
```

Expect `Signer #1 certificate DN: CN=DerLog, O=DerLog, C=KH`.

## 5. Java version

Android Studio ships JDK 25, which AGP 8.7.2's lint step rejects
(`IllegalArgumentException: 25.0.4`). The project therefore pins Gradle to a local
JDK 21 in `.toolchain/jdk-21…`, and both `tools/setup-android-release.mjs` and
`tools/build-android-release.mjs` prefer it automatically. `.toolchain/` is git-ignored;
download Temurin 21 (Windows x64) from <https://adoptium.net/temurin/releases/?version=21>,
unzip it into `.toolchain/`, and re-run `npm run android:sign` on a fresh clone.

## 6. Working in Android Studio

Open the **`android`** folder as the project (or `npm run android:open`).

- Gradle JDK: Settings → Build, Execution, Deployment → Build Tools → Gradle, set
  "Gradle JDK" to `.toolchain\jdk-21...` (the value in `gradle.properties` is used unless
  the IDE overrides it).
- **Run ▶** installs a debug build on the emulator or phone.
- **Build → Generate Signed Bundle / APK** also works with the same keystore; the plain
  `npm run android:release` is faster for handing a file to testers.
- Launcher icon and splash come from `resources/icon.png` and `resources/splash.png`
  (`npm run icons` regenerates every mipmap size; those folders are generated, so re-run
  it if you recreate `android/`).

## 7. Install on a phone

Send `app-release.apk` (Drive, email, USB) and open it; allow "install unknown apps" for
the app you launch it from. Play Protect may show a generic "app not scanned" card for
any app that did not come from Play — tap **Install anyway**. A Play Store release needs
an AAB (`bundleRelease`), a Play Console account and the same keystore.
