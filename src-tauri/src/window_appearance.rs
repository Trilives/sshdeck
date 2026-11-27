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
        paint(
            app,
            settings,
            mode.or_else(|| window.theme().ok()).unwrap_or(Theme::Light),
            None,
        );
    }
}

pub fn paint(app: &AppHandle, settings: &AppSettings, theme: Theme, focused: Option<bool>) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Graphics::Dwm::{
            DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR, DWMWA_COLOR_DEFAULT,
            DWMWA_TEXT_COLOR,
        };

        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        let Ok(hwnd) = window.hwnd() else {
            return;
        };
        let dark = match settings.theme.as_str() {
            "dark" => true,
            "light" => false,
            _ => theme == Theme::Dark,
        };
        let (caption, border) = match (settings.accent_color.as_str(), dark) {
            ("violet", false) => ([243, 238, 253], [167, 139, 250]),
            ("violet", true) => ([41, 32, 57], [139, 92, 246]),
            ("teal", false) => ([231, 246, 243], [56, 157, 146]),
            ("teal", true) => ([25, 45, 43], [45, 163, 154]),
            ("orange", false) => ([253, 240, 232], [220, 128, 84]),
            ("orange", true) => ([53, 37, 31], [214, 110, 68]),
            (_, false) => ([235, 242, 253], [105, 149, 231]),
            (_, true) => ([29, 41, 62], [88, 138, 230]),
        };
        let color_ref = |[r, g, b]: [u8; 3]| u32::from_le_bytes([r, g, b, 0]);
        let caption = color_ref(caption);
        let border = if focused.unwrap_or_else(|| window.is_focused().unwrap_or(false)) {
            color_ref(border)
        } else {
            DWMWA_COLOR_DEFAULT
        };
        let text = if dark { 0x00fa_f8f8u32 } else { 0x0030_241cu32 };
        // Windows versions without support reject these attributes and keep their native colors.
        unsafe {
            let result = DwmSetWindowAttribute(
                hwnd.0,
                DWMWA_CAPTION_COLOR as u32,
                (&caption as *const u32).cast(),
                4,
            );
            if result >= 0 {
                let _ = DwmSetWindowAttribute(
                    hwnd.0,
                    DWMWA_TEXT_COLOR as u32,
                    (&text as *const u32).cast(),
                    4,
                );
            }
            let _ = DwmSetWindowAttribute(
                hwnd.0,
                DWMWA_BORDER_COLOR as u32,
                (&border as *const u32).cast(),
                4,
            );
        }
    }

    #[cfg(not(windows))]
    let _ = (app, settings, theme, focused);
}
