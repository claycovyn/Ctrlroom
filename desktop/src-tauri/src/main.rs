// Ctrl Room desktop: one window on the Ctrl Room web app. The site is the app; this only gives it a native window,
// icon and installer. The page gets no access to native APIs (no capabilities are granted to the remote origin).
// Links to any other site, and anything that asks for a new window, open in the system browser instead.
// Calls: camera, mic and screen share are allowed for the app's own host only (see `permission`).
// Updates: the app looks for a new version at launch and every few hours (see `look_for_update`).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::webview::{NewWindowResponse, PermissionKind, PermissionResponse};
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_updater::{Update, UpdaterExt};

// How often a running app looks for a new version (it also looks at launch). The feed is `plugins.updater.endpoints`
// in tauri.conf.json: latest.json on the public downloads repo's latest release.
const UPDATE_EVERY: Duration = Duration::from_secs(6 * 60 * 60);
// One "Update ready" question at a time.
static ASKING: AtomicBool = AtomicBool::new(false);
// macOS and Linux: the version already installed on disk, waiting for a restart (don't fetch it again).
static INSTALLED: Mutex<Option<String>> = Mutex::new(None);

// The live web app. Change this (and `build.frontendDist` in tauri.conf.json) if the domain changes.
const HOME: &str = "https://www.openctrlroom.app";
// The bare domain redirects to HOME, so it stays in the window too.
const APEX: &str = "openctrlroom.app";
// Where the window opens: signed in, the server sends you to your community (or your messages when you're in more
// than one); signed out, to sign in. See `desktopLaunch` in src/lib/lastPlace.ts.
const START: &str = "https://www.openctrlroom.app/app?launch=desktop";

fn is_home(url: &url::Url) -> bool {
    let home: url::Url = HOME.parse().expect("valid home URL");
    url.scheme() == "https" && (url.host_str() == home.host_str() || url.host_str() == Some(APEX))
}

fn open_outside(url: &url::Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
    }
}

// What a call needs. Only the app's own page may ask; anything else is refused.
// Linux (WebKitGTK) has no prompt of its own and denies by default, so the app allows there.
// Windows (WebView2) and macOS (WKWebView) keep their own "allow camera / microphone" prompt.
fn permission(page: Option<url::Url>, kind: PermissionKind) -> PermissionResponse {
    let call = matches!(
        kind,
        PermissionKind::Camera | PermissionKind::Microphone | PermissionKind::DisplayCapture | PermissionKind::Notifications
    );
    if !call {
        return PermissionResponse::Default;
    }
    if !page.as_ref().is_some_and(is_home) {
        return PermissionResponse::Deny;
    }
    if cfg!(target_os = "linux") {
        PermissionResponse::Allow
    } else {
        PermissionResponse::Default
    }
}

type AnyError = Box<dyn std::error::Error + Send + Sync>;

// Download a newer version if there is one (checked against the key in tauri.conf.json), then ask to restart.
// Windows: installing closes the app and the installer opens it again, so it installs only on "Restart now"; on
// "Later" the next check asks again. macOS and Linux: the new version replaces the app on disk right away and takes
// effect the next time it opens, whether or not you restart now.
async fn look_for_update(app: &AppHandle) -> Result<(), AnyError> {
    let Some(update) = app.updater()?.check().await? else {
        return Ok(());
    };
    if INSTALLED.lock().unwrap().as_deref() == Some(update.version.as_str()) || ASKING.load(Ordering::SeqCst) {
        return Ok(());
    }
    let bytes = update.download(|_, _| {}, || {}).await?;
    if cfg!(target_os = "windows") {
        ask_to_restart(app, update, Some(bytes));
    } else {
        update.install(&bytes)?;
        *INSTALLED.lock().unwrap() = Some(update.version.clone());
        ask_to_restart(app, update, None);
    }
    Ok(())
}

fn ask_to_restart(app: &AppHandle, update: Update, bytes: Option<Vec<u8>>) {
    if ASKING.swap(true, Ordering::SeqCst) {
        return;
    }
    let handle = app.clone();
    app.dialog()
        .message(format!("Ctrl Room {} is ready. Restart to start using it.", update.version))
        .title("Update ready")
        .buttons(MessageDialogButtons::OkCancelCustom("Restart now".into(), "Later".into()))
        .show(move |restart| {
            ASKING.store(false, Ordering::SeqCst);
            if !restart {
                return;
            }
            if let Some(bytes) = bytes {
                if update.install(&bytes).is_err() {
                    return;
                }
            }
            handle.restart();
        });
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // Release builds only: `npm run dev` never updates itself.
            if !cfg!(debug_assertions) {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    loop {
                        // Offline, or the feed is unreachable: try again at the next check.
                        let _ = look_for_update(&handle).await;
                        tokio::time::sleep(UPDATE_EVERY).await;
                    }
                });
            }
            let start = START.parse().expect("valid start URL");
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(start))
                .title("Ctrl Room")
                .inner_size(1280.0, 840.0)
                .min_inner_size(380.0, 600.0)
                .on_navigation(|url| {
                    if is_home(url) || url.scheme() == "about" {
                        return true;
                    }
                    open_outside(url);
                    false
                })
                .on_new_window(|url, _features| {
                    open_outside(&url);
                    NewWindowResponse::Deny
                })
                .on_permission_request(|webview, kind| permission(webview.url().ok(), kind))
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Ctrl Room");
}
