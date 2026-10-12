# Ctrl Room desktop

A native window around the Ctrl Room web app ([ctrlroom-iota.vercel.app](https://ctrlroom-iota.vercel.app)) for
Windows, macOS and Linux, built with [Tauri 2](https://tauri.app). The site is the app: there is no separate frontend
here, and the page gets no access to native APIs (no Tauri capabilities are granted to the remote page).

- Only the app's own host loads in the window. Every other link (confirmation emails, GitHub, other docs) and anything
  that asks for a new window opens in your normal browser.
- The address lives in one place: `HOME` in `src-tauri/src/main.rs`, plus `build.frontendDist` in
  `src-tauri/tauri.conf.json`. Change both when a custom domain is attached.

## Calls, screen share and notifications

Camera, microphone, screen share and notification requests are answered by `permission()` in `src-tauri/src/main.rs`:
refused for any page that isn't the app's own host, otherwise handed to the platform as below.

| | Calls (camera, mic) | Screen share | Notifications |
| --- | --- | --- | --- |
| Windows (WebView2) | Expected to work: WebView2 shows its own allow prompt the first time | Expected to work (WebView2 supports `getDisplayMedia`) | Expected to work after the in-app prompt |
| macOS (WKWebView) | Expected to work: macOS asks for camera and mic access using the lines in `src-tauri/Info.plist`, then the webview asks once per site | Expected to work on macOS 13+; macOS asks for Screen Recording access | Not expected: WKWebView does not offer the web `Notification` API, so the app shows notifications as unsupported |
| Linux (WebKitGTK) | Expected to work: WebKitGTK has no prompt and denies by default, so the app allows these for its own host | Unknown: depends on the WebKitGTK version and the desktop's screen-capture portal (PipeWire) | Expected to work, allowed for the app's own host |

**Status: verified in CI build only.** The CI builds compile and package on all three platforms. None of the rows above
has been tried by hand on a real machine yet; until it has, treat them as expected behaviour, not tested behaviour.

macOS details: `src-tauri/Info.plist` is merged into the app bundle and carries `NSCameraUsageDescription` and
`NSMicrophoneUsageDescription`. `src-tauri/Entitlements.plist` (`com.apple.security.device.camera`,
`com.apple.security.device.audio-input`) is set as `bundle.macOS.entitlements`. Entitlements only take effect once the
app is code-signed with the hardened runtime; the current unsigned build relies on the Info.plist lines alone.

## Get it

GitHub → Actions → **Desktop**: every change to `desktop/` builds installers (`.msi` / `.exe`, `.dmg`,
`.deb` / `.AppImage` / `.rpm`) as workflow artifacts. Push a tag `desktop-vX.Y.Z` to attach them to a draft release.

The builds are **unsigned** for now. Windows SmartScreen shows "Windows protected your PC" (More info → Run anyway);
macOS needs right-click → Open the first time. Signing needs a Windows code-signing certificate and an Apple Developer
account, added as repository secrets.

## Build locally

Needs Node, Rust (`rustup`) and the Tauri prerequisites for your OS (on Windows: Visual Studio Build Tools with the
C++ workload; WebView2 ships with Windows 11).

```bash
cd desktop
npm install
npm run dev     # opens the window
npm run build   # installers in src-tauri/target/release/bundle
npm run icons   # regenerate src-tauri/icons from public/brand/ctrlroom-icon-1024.png (then delete icons/android and icons/ios)
```

When the version changes, bump it in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`.

The web app's typecheck, lint and build ignore this folder (`tsconfig.json` exclude, `.eslintrc.json` ignorePatterns).
