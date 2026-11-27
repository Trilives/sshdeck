use std::{
    io::Cursor,
    sync::{Mutex, OnceLock},
};

use tauri::{image::Image, AppHandle, Manager};
use windows::Win32::{
    Foundation::{LPARAM, WPARAM},
    UI::WindowsAndMessaging::{
        CreateIconFromResourceEx, DestroyIcon, SendMessageW, HICON, ICON_BIG, LR_DEFAULTCOLOR,
        WM_SETICON,
    },
};

use crate::{desktop_shortcut, TRAY_ID};

static LARGE_ICON: OnceLock<Option<Image<'static>>> = OnceLock::new();

#[derive(Clone, Copy, PartialEq, Eq)]
struct Tint {
    name: &'static str,
    color: [u8; 3],
}

#[derive(Default)]
pub struct WindowIcons(Mutex<Option<AppliedIcon>>);

struct AppliedIcon {
    tint: Option<Tint>,
    // Windows borrows the HICON until another icon replaces it.
    taskbar_handle: usize,
}

impl Drop for AppliedIcon {
    fn drop(&mut self) {
        let _ = unsafe { DestroyIcon(HICON(self.taskbar_handle as _)) };
    }
}

fn tint_for(accent: &str, dark: bool) -> Option<Tint> {
    let (name, color) = match (accent, dark) {
        ("violet", _) => ("violet", [124, 58, 237]),
        ("teal", _) => ("teal", [20, 100, 94]),
        ("orange", _) => ("orange", [166, 54, 13]),
        ("monochrome", false) => ("monochrome-light", [23, 23, 23]),
        ("monochrome", true) => ("monochrome-dark", [82, 82, 82]),
        _ => return None,
    };
    Some(Tint { name, color })
}

pub fn apply(app: &AppHandle, accent: &str, dark: bool) {
    let tint = tint_for(accent, dark);
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || set_icons(&handle, tint));
}

fn set_icons(app: &AppHandle, tint: Option<Tint>) {
    let (Some(window), Some(state)) = (
        app.get_webview_window("main"),
        app.try_state::<WindowIcons>(),
    ) else {
        return;
    };
    let Ok(mut current) = state.0.lock() else {
        return;
    };
    if current.as_ref().is_some_and(|icon| icon.tint == tint) {
        return;
    }

    let (Ok(hwnd), Some(small), Some(large)) = (
        window.hwnd(),
        app.default_window_icon(),
        LARGE_ICON.get_or_init(load_large_icon).as_ref(),
    ) else {
        return;
    };
    let small = tint.map_or_else(|| small.clone(), |tint| recolor(small, tint.color));
    let large = tint.map_or_else(|| large.clone(), |tint| recolor(large, tint.color));
    let image =
        ico::IconImage::from_rgba_data(large.width(), large.height(), large.rgba().to_vec());
    let Ok(resource) = ico::IconDirEntry::encode_as_bmp(&image) else {
        return;
    };
    let Ok(taskbar) = (unsafe {
        CreateIconFromResourceEx(resource.data(), true, 0x0003_0000, 0, 0, LR_DEFAULTCOLOR)
    }) else {
        return;
    };
    let applied = AppliedIcon {
        tint,
        taskbar_handle: taskbar.0 as usize,
    };
    if window.set_icon(small.clone()).is_err() {
        return;
    }
    unsafe {
        SendMessageW(
            hwnd,
            WM_SETICON,
            Some(WPARAM(ICON_BIG as usize)),
            Some(LPARAM(taskbar.0 as isize)),
        );
    }
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_icon(Some(small));
    }
    *current = Some(applied);

    if let Some(tint) = tint {
        let mut icon = ico::IconDir::new(ico::ResourceType::Icon);
        icon.add_entry(resource);
        let mut bytes = Vec::new();
        if icon.write(&mut bytes).is_ok() {
            desktop_shortcut::queue(Some((tint.name, bytes)));
        }
    } else {
        desktop_shortcut::queue(None);
    }
}

fn load_large_icon() -> Option<Image<'static>> {
    let icons = ico::IconDir::read(Cursor::new(include_bytes!("../icons/icon.ico"))).ok()?;
    let icon = icons.entries().iter().max_by_key(|icon| icon.width())?;
    let image = icon.decode().ok()?;
    Some(Image::new_owned(
        image.rgba_data().to_vec(),
        image.width(),
        image.height(),
    ))
}

fn recolor(source: &Image<'_>, color: [u8; 3]) -> Image<'static> {
    let mut rgba = source.rgba().to_vec();
    for pixel in rgba.chunks_exact_mut(4) {
        // The bundled artwork is a white letter on a pure blue background.
        // The red channel stores the white letter's coverage at antialiased edges.
        let white = u16::from(pixel[0]);
        for (channel, base) in pixel.iter_mut().zip(color) {
            *channel = ((u16::from(base) * (255 - white) + 255 * white + 127) / 255) as u8;
        }
    }
    Image::new_owned(rgba, source.width(), source.height())
}
