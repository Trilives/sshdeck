use std::{
    fs,
    io::Write,
    path::PathBuf,
    process::{Command, Stdio},
    sync::{atomic::AtomicBool, Arc},
    time::Duration,
};

use tauri::{AppHandle, Manager};

use crate::model::Host;
use crate::ssh::command::build_key_upload_command;
use crate::ssh::process::{apply_askpass, prepare_askpass_helper};
use crate::ssh::worker::Worker;
use crate::state::AppState;
use crate::util::no_window;

/// Keep the preflight and the mutation in one guard, including callers that did
/// not run a frontend probe. Return false when nothing needs to be changed.
pub fn upload_if_needed(
    status: &str,
    password: &str,
    upload: impl FnOnce() -> Result<(), String>,
) -> Result<bool, String> {
    match status {
        "ready" => return Ok(false),
        "host_key_changed" => return Err("Host key changed; verify the server fingerprint before uploading / 主机指纹已变更，请先核对指纹".into()),
        "password_required" => {},
        _ => return Err("Cannot determine SSH authentication status / 无法确认认证状态".into()),
    }
    if password.is_empty() {
        return Err("Password is required / 请输入服务器密码后上传密钥".into());
    }
    upload()?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn passwordless_access_skips_key_generation_and_upload_even_without_password() {
        assert!(!upload_if_needed("ready", "", || panic!("must not modify keys")).unwrap());
        assert!(
            !upload_if_needed("ready", "unnecessary", || panic!("must not modify keys")).unwrap()
        );
        for status in ["host_key_changed", "unknown"] {
            assert!(
                upload_if_needed(status, "password", || panic!("must not modify keys")).is_err()
            );
        }
        assert!(
            upload_if_needed("password_required", "", || panic!("must not modify keys")).is_err()
        );
        let mut changed = false;
        assert!(upload_if_needed("password_required", "password", || {
            changed = true;
            Ok(())
        })
        .unwrap());
        assert!(changed);
    }
}

/// Ensure a private key and its matching public key exist locally, returning the public key content. Auto-generates an ed25519 pair if the private key is missing.
pub fn ensure_public_key(host: &Host, app: &AppHandle) -> Result<String, String> {
    let private_key = resolve_identity_file(&host.identity_file)?;
    let public_key = PathBuf::from(format!("{}.pub", private_key.to_string_lossy()));
    if !private_key.exists() {
        if let Some(parent) = private_key.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        let mut keygen = Command::new("ssh-keygen");
        keygen
            .args([
                "-t",
                "ed25519",
                "-N",
                "",
                "-C",
                "sshdeck",
                "-f",
                private_key
                    .to_str()
                    .ok_or_else(|| "Identity file path contains invalid characters.".to_string())?,
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        no_window(&mut keygen);
        let output = keygen.output().map_err(|err| err.to_string())?;
        if !output.status.success() {
            return Err(format!(
                "ssh-keygen failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        let state = app.state::<AppState>();
        state.add_log(
            "info",
            format!("[key] generated {}", private_key.display()),
            Some(app),
        );
    }

    if !public_key.exists() {
        let mut derive = Command::new("ssh-keygen");
        derive
            .args([
                "-y",
                "-f",
                private_key
                    .to_str()
                    .ok_or_else(|| "Identity file path contains invalid characters.".to_string())?,
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        no_window(&mut derive);
        let output = derive.output().map_err(|err| err.to_string())?;
        if !output.status.success() {
            return Err(format!(
                "Cannot derive public key: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        fs::write(&public_key, output.stdout).map_err(|err| err.to_string())?;
    }

    fs::read_to_string(&public_key)
        .map(|value| value.trim().to_string())
        .map_err(|err| err.to_string())
}

pub fn resolve_identity_file(identity_file: &str) -> Result<PathBuf, String> {
    let trimmed = identity_file.trim();
    if trimmed.is_empty() {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .map_err(|_| "Cannot locate user home directory.".to_string())?;
        return Ok(PathBuf::from(home).join(".ssh").join("id_ed25519"));
    }

    if let Some(rest) = trimmed
        .strip_prefix("~/")
        .or_else(|| trimmed.strip_prefix("~\\"))
    {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .map_err(|_| "Cannot locate user home directory.".to_string())?;
        return Ok(PathBuf::from(home).join(rest));
    }

    Ok(PathBuf::from(trimmed))
}

pub fn upload_key_to_remote(
    host: &Host,
    public_key: &str,
    password: &str,
    state: &AppState,
    app: &AppHandle,
) -> Result<(), String> {
    let command = build_key_upload_command(host)?;
    state.add_log(
        "debug",
        format!("[{}] $ {}", host.name, command.join(" ")),
        Some(app),
    );
    let helper = prepare_askpass_helper(&state.data_dir)?;
    let mut process = Command::new(&command[0]);
    process
        .args(&command[1..])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_askpass(&mut process, helper, password);
    no_window(&mut process);
    let mut worker = Worker::spawn(&mut process)?;
    let mut stdin = worker.child.stdin.take().ok_or("Missing SSH stdin")?;
    let input = format!("{public_key}\n");
    std::thread::spawn(move || {
        let _ = stdin.write_all(input.as_bytes());
    });
    let (status, output) =
        worker.wait(Duration::from_secs(45), &Arc::new(AtomicBool::new(false)))?;
    if !status.success() {
        return Err(format!("Upload public key failed: {}", output.trim()));
    }
    Ok(())
}
