use std::{
    ffi::OsString,
    fs,
    os::windows::ffi::{OsStrExt, OsStringExt},
    path::{Path, PathBuf},
    sync::{
        mpsc::{self, Sender},
        OnceLock,
    },
};

use windows::{
    core::{Interface, PCWSTR},
    Win32::{
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
            COINIT_APARTMENTTHREADED, STGM_READWRITE,
        },
        UI::Shell::{IShellLinkW, SHChangeNotify, ShellLink, SHCNE_UPDATEITEM, SHCNF_PATHW},
    },
};

type ShortcutUpdate = Option<(&'static str, Vec<u8>)>;
const ICON_PREFIX: &str = "sshdeck-theme-v1-";
static UPDATES: OnceLock<Option<Sender<ShortcutUpdate>>> = OnceLock::new();

pub fn queue(update: ShortcutUpdate) {
    let worker = UPDATES.get_or_init(|| {
        let (sender, receiver) = mpsc::channel();
        std::thread::Builder::new()
            .name("sshdeck-desktop-icon".into())
            .spawn(move || {
                if unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.is_err() {
                    return;
                }
                while let Ok(update) = receiver.recv() {
                    // Apply the newest pending color and keep filesystem work off the UI thread.
                    update_shortcut(receiver.try_iter().last().unwrap_or(update));
                }
                unsafe { CoUninitialize() };
            })
            .ok()?;
        Some(sender)
    });
    if let Some(sender) = worker {
        let _ = sender.send(update);
    }
}

fn update_shortcut(update: ShortcutUpdate) -> Option<()> {
    let path = desktop_dir()?.join("SSHDeck.lnk");
    if !fs::symlink_metadata(&path).ok()?.is_file() {
        return None;
    }
    let exe = std::env::current_exe().ok()?;
    let icon_dir = crate::app_data::resolve().join("icons");
    let shortcut_path = wide(&path);
    let link: IShellLinkW =
        unsafe { CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER) }.ok()?;
    let persist: IPersistFile = link.cast().ok()?;
    unsafe { persist.Load(PCWSTR(shortcut_path.as_ptr()), STGM_READWRITE) }.ok()?;

    let mut text = vec![0; 32768];
    unsafe { link.GetPath(&mut text, std::ptr::null_mut(), 0) }.ok()?;
    let target = read_path(&text);
    if !same_exe(&target, &exe) {
        return None;
    }

    text.fill(0);
    let mut index = 0;
    unsafe { link.GetIconLocation(&mut text, &mut index) }.ok()?;
    let old_icon = read_path(&text);
    let managed_icon = old_icon.parent() == Some(icon_dir.as_path())
        && old_icon
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with(ICON_PREFIX) && name.ends_with(".ico"));
    let default_icon = old_icon.as_os_str().is_empty() || same_exe(&old_icon, &exe);
    if index != 0 || (!default_icon && !managed_icon) {
        return None;
    }

    let new_icon = match update {
        Some((name, data)) => {
            fs::create_dir_all(&icon_dir).ok()?;
            let themed = icon_dir.join(format!("{ICON_PREFIX}{name}.ico"));
            if !themed.is_file() {
                let temporary = themed.with_extension("tmp");
                fs::write(&temporary, data).ok()?;
                fs::rename(temporary, &themed).ok()?;
            }
            themed
        }
        None if managed_icon => exe,
        None => return Some(()),
    };
    if new_icon == old_icon {
        return Some(());
    }

    let icon_location = wide(&new_icon);
    unsafe {
        link.SetIconLocation(PCWSTR(icon_location.as_ptr()), 0)
            .ok()?;
        persist.Save(PCWSTR(shortcut_path.as_ptr()), true).ok()?;
        drop(persist);
        drop(link);
        SHChangeNotify(
            SHCNE_UPDATEITEM,
            SHCNF_PATHW,
            Some(shortcut_path.as_ptr().cast()),
            None,
        );
    }
    Some(())
}

fn desktop_dir() -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    if let Some(profile) = std::env::var_os("SSHDECK_TEST_DATA_DIR").map(PathBuf::from) {
        return Some(profile.join("desktop"));
    }
    Some(directories::UserDirs::new()?.desktop_dir()?.to_path_buf())
}

fn same_exe(path: &Path, exe: &Path) -> bool {
    path.canonicalize()
        .is_ok_and(|path| exe.canonicalize().is_ok_and(|exe| path == exe))
}

fn read_path(buf: &[u16]) -> PathBuf {
    let len = buf
        .iter()
        .position(|&value| value == 0)
        .unwrap_or(buf.len());
    PathBuf::from(OsString::from_wide(&buf[..len]))
}

fn wide(path: &Path) -> Vec<u16> {
    path.as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}
