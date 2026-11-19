# Release-signed Android build

A release APK is signed with your own key instead of the Android debug key, so
testers see a normal app (no “debug” badge and no debug-signature warning).

## Files (never committed)

| Path | Purpose |
| --- | --- |
| `signing/derlog-release.jks` | RSA 2048 keystore, alias `derlog`, valid 10,000 days |
| `signing/keystore.properties` | Store/key passwords and keystore path |

Both are git-ignored. **Back them up now** (password manager or encrypted drive).
If the keystore is lost you cannot ship an update that installs over an existing
install — testers would have to uninstall first.

## First-time setup

```bash
npm install
node tools/setup-android-release.mjs   # or: npm run android:sign
```

The script creates the keystore if missing, writes `signing/keystore.properties`,
sets `sdk.dir` in `android/local.properties`, points Gradle at Android Studio's
JDK 21, and adds the `signingConfigs.release` block to
`android/app/build.gradle`. It is idempotent — re-run it after regenerating the
`android/` folder with `npx cap add android`.

## Build

```bash
npm run android:release
```

This runs, in order:

1. `node tools/build-www.mjs` — rebuilds `www/` from `DerLog-v19.html`
2. `npx cap sync android` — copies assets and plugins into the native project
3. `android/gradlew.bat assembleRelease` — signs and assembles the APK

Output:

```
android/app/build/outputs/apk/release/app-release.apk
```

Version identifiers live in `android/app/build.gradle`
(`versionCode 2`, `versionName "1.23.1"`); raise `versionCode` for every build
you hand out.

## Verify the signature

```bash
"%LOCALAPPDATA%\Android\Sdk\build-tools\35.0.0\apksigner.bat" verify --print-certs ^
  android\app\build\outputs\apk\release\app-release.apk
```

Expected: `Signer #1 certificate DN: CN=DerLog, O=DerLog, C=KH`.

## Install on a phone

Send `app-release.apk` (Drive, email, USB) and tap it; allow “install unknown
apps” for the app you open it from.

Play Protect can still show “app not scanned” for any app that did not come from
Play — that is expected for self-distributed builds. Tapping **Install anyway**
continues. Publishing to Play (AAB instead of APK) additionally requires a Play
Console account and `bundleRelease`.

## Android Studio alternative

Open the project (`npm run android:open`), then **Build → Generate Signed Bundle
/ APK** and select the same keystore and alias. The manual Gradle command above
is faster and repeatable.
