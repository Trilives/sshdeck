use tauri::{AppHandle, Manager, Theme};

use crate::model::AppSettings;

pub fn apply(app: &AppHandle, settings: &AppSettings) {
    if let Some(window) = app.get_webview_window("main") {
        let mode = match settings.theme.as_str() {
            "light" => Some(Theme::Light),
            "dark" => Some(Theme::Dark),
            _ => None,
        };
        let _ = window.set_theme(mode);
        paint(app, settings, mode.or_else(|| window.theme().ok()).unwrap_or(Theme::Light));
    }
}

pub fn paint(app: &AppHandle, settings: &AppSettings, theme: Theme) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Graphics::Dwm::{
            DwmSetWindowAttribute, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR,
        };

        let Some(hwnd) = app.get_webview_window("main").and_then(|window| window.hwnd().ok()) else {
            return;
        };
        let dark = match settings.theme.as_str() {
            "dark" => true,
            "light" => false,
            _ => theme == Theme::Dark,
        };
        let rgb = match (settings.accent_color.as_str(), dark) {
            ("violet", false) => [243, 238, 253],
            ("violet", true) => [41, 32, 57],
            ("teal", false) => [231, 246, 243],
            ("teal", true) => [25, 45, 43],
            ("orange", false) => [253, 240, 232],
            ("orange", true) => [53, 37, 31],
            (_, false) => [235, 242, 253],
            (_, true) => [29, 41, 62],
        };
        let caption = u32::from_le_bytes([rgb[0], rgb[1], rgb[2], 0]);
        let text = if dark { 0x00fa_f8f8u32 } else { 0x0030_241cu32 };
        // Windows versions without support reject the caption attribute and keep their native colors.
        unsafe {
            let result = DwmSetWindowAttribute(
                hwnd.0, DWMWA_CAPTION_COLOR as u32, (&caption as *const u32).cast(), 4,
            );
            if result >= 0 {
                let _ = DwmSetWindowAttribute(
                    hwnd.0, DWMWA_TEXT_COLOR as u32, (&text as *const u32).cast(), 4,
                );
            }
        }
    }

    #[cfg(not(windows))]
    let _ = (app, settings, theme);
}
