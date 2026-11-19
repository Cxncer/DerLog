# Distributing DerLog for testing

DerLog is a static site: `DerLog-v19.html` plus `manifest.webmanifest`, `sw.js` and the two
icon files. There is no server code except the optional local photo service, so any static
host works.

## 1. Same Wi-Fi test (fastest, no accounts)

```bash
python -m http.server 54830 --bind 0.0.0.0
```

Find the computer's address with `ipconfig` (IPv4, e.g. `192.168.1.20`) and open
`http://192.168.1.20:54830/DerLog-v19.html` on the phone.

- Android Chrome: ⋮ → **Add to Home screen**.
- iPhone Safari: Share → **Add to Home Screen**.

Plain HTTP is not a secure context, so the service worker and true PWA install stay
inactive; the app works online, but not offline. The local photo service is reachable too,
because it now listens on all interfaces (`HOST=0.0.0.0`) and DerLog points at
`http://<page-host>:3211`. Allow port 3211 through the computer firewall the first time.

## 2. HTTPS host (installable PWA, no Android Studio)

Any static host on HTTPS gives offline support and a real install prompt.

**Netlify Drop**

1. Run `npm run build` (creates `www/`, a self-contained bundle with React, Tailwind,
   Leaflet, PDF.js and the fonts included).
2. Open <https://app.netlify.com/drop> and drag the `www` folder in.
3. Share the URL; testers use the browser's Install / Add to Home Screen action.

**GitHub Pages**

1. Push this repository to GitHub.
2. Settings → Pages → Deploy from a branch → `master` / `/ (root)`.
3. The site opens at `https://<user>.github.io/<repo>/` (root `index.html` forwards to
   the app).

The repo's photo service is a local helper and cannot be deployed this way; on a hosted
site the slideshow falls back to the built-in Wikimedia/Openverse photos. For Pinterest
photos on hosted builds, host the service separately and change `PHOTO_SERVICE_ORIGIN`
in `DerLog-v19.html`.

## 3. Android APK via Capacitor (needs Android Studio)

Prerequisites:

- Node.js 20+ and npm
- JDK 21 (bundled with recent Android Studio)
- [Android Studio](https://developer.android.com/studio) with the Android 35 SDK
  and a phone or emulator

Steps:

```bash
npm install
npm run build          # produces www/ (offline bundle)
npx cap add android    # one time, creates android/
npm run android:sign   # keystore + signing config + Gradle JDK
npm run android:open   # opens Android Studio
```

In Android Studio press **Run ▶**. For a sharable, properly signed file use
`npm run android:release` — see `RELEASE.md` for details, verification and the keystore
backup warning.

Notes:

- The app inside the APK is the same `www/` build. Update it with `npm run android:sync`
  after changing `DerLog-v19.html`.
- Google sign-in uses the existing OAuth web client. For a production APK, add the
  Android package/SHA-1 to that client in Google Cloud Console and set the app's origin,
  otherwise cloud sign-in stays unavailable and testers use the offline account.
- The local Pinterest photo service is not bundled; the APK uses the Wikimedia/Openverse
  fallback unless the service is hosted at a reachable HTTPS URL.
- `android/` and `www/` are generated; keep them out of review diffs.
