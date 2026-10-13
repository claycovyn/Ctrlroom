// Ctrl Room desktop: one window on the Ctrl Room web app. The site is the app; this only gives it a native window,
// icon and installer. The page gets no access to native APIs (no capabilities are granted to the remote origin).
// Links to any other site, and anything that asks for a new window, open in the system browser instead.
// Calls: camera, mic and screen share are allowed for the app's own host only (see `permission`).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::webview::{NewWindowResponse, PermissionKind, PermissionResponse};
use tauri::{WebviewUrl, WebviewWindowBuilder};

// The live web app. Change this (and `build.frontendDist` in tauri.conf.json) if the domain changes.
const HOME: &str = "https://www.openctrlroom.app";
// The bare domain redirects to HOME, so it stays in the window too.
const APEX: &str = "openctrlroom.app";

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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let home = HOME.parse().expect("valid home URL");
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(home))
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
