#[tauri::command]
pub fn get_launch_at_login() -> Result<bool, String> {
    #[cfg(windows)]
    return windows::is_enabled()
        .map_err(|err| format!("Could not read the Windows startup entry: {err}"));

    #[cfg(not(windows))]
    Ok(false)
}

#[tauri::command]
pub fn set_launch_at_login(enabled: bool) -> Result<bool, String> {
    #[cfg(windows)]
    return windows::set_enabled(enabled)
        .map(|()| enabled)
        .map_err(|err| format!("Could not update the Windows startup entry: {err}"));

    #[cfg(not(windows))]
    Err(format!(
        "Launch at login (requested: {enabled}) is only available on Windows."
    ))
}

#[cfg(windows)]
mod windows {
    use std::{ffi::OsString, io, os::windows::ffi::OsStrExt};
    use winreg::{
        enums::{HKEY_CURRENT_USER, KEY_SET_VALUE},
        RegKey,
    };

    const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const ENTRY: &str = "SSHDeck";

    pub fn is_enabled() -> io::Result<bool> {
        let value = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey(RUN_KEY)
            .and_then(|key| key.get_value::<OsString, _>(ENTRY));
        match value {
            Ok(command) => Ok(!command.is_empty()),
            Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(false),
            Err(err) => Err(err),
        }
    }

    pub fn set_enabled(enabled: bool) -> io::Result<()> {
        let user = RegKey::predef(HKEY_CURRENT_USER);
        if enabled {
            let exe = std::env::current_exe()?;
            let mut command = OsString::from("\"");
            command.push(exe);
            command.push("\"");
            if command.encode_wide().count() > 260 {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "SSHDeck's executable path is too long for Windows startup.",
                ));
            }
            let (key, _) = user.create_subkey_with_flags(RUN_KEY, KEY_SET_VALUE)?;
            return key.set_value(ENTRY, &command);
        }

        match user
            .open_subkey_with_flags(RUN_KEY, KEY_SET_VALUE)
            .and_then(|key| key.delete_value(ENTRY))
        {
            Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
            result => result,
        }
    }
}
