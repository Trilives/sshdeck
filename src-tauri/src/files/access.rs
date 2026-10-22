//! Provision direct SSH access using only public keys relayed by this computer.
use super::{jobs::direct_command, Endpoint};
use crate::{
    model::Host,
    ssh::{
        command::build_send_command,
        process::{apply_askpass, prepare_askpass_helper},
        worker::{Cancel, Worker},
    },
    util::no_window,
};
use serde::Serialize;
use std::{
    path::Path,
    process::{Command, Stdio},
    time::Duration,
};

pub const SOURCE_KEY: &str = r#"set -eu
umask 077
command -v sftp >/dev/null || { echo 'Source server needs OpenSSH sftp' >&2; exit 1; }
mkdir -p "$HOME/.ssh"
lock="$HOME/.ssh/sshdeck-key-setup.lock"
mkdir "$lock" 2>/dev/null || { echo 'Another key setup is running on the source' >&2; exit 1; }
trap 'rm -f "$lock/public"; rmdir "$lock"' EXIT HUP INT TERM
key="$HOME/.ssh/sshdeck_ed25519"
[ ! -L "$key" ] && [ ! -L "$key.pub" ] || { echo 'Refusing a symbolic link for the direct SSH key' >&2; exit 1; }
if [ ! -f "$key" ]; then
  ssh-keygen -q -t ed25519 -N '' -C sshdeck-direct -f "$key" </dev/null
fi
chmod 600 "$key"
if ! ssh-keygen -y -P '' -f "$key" > "$lock/public" 2>/dev/null; then
  echo 'The dedicated source key is unreadable or encrypted; configure an unencrypted sshdeck_ed25519 key on the source' >&2
  exit 1
fi
mv "$lock/public" "$key.pub"
cat "$key.pub""#;

const TARGET_KEYS: &str = r#"set -eu
for key in /etc/ssh/ssh_host_*_key.pub; do
  if [ -f "$key" ]; then cat "$key"; printf '\n'; fi
done"#;

pub fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub fn known_hosts_file(host: &Host) -> Result<String, String> {
    // Reuse the same address/port validation as the direct sftp invocation.
    direct_command(host)?;
    Ok(format!(
        "sshdeck_known_hosts_{}_{}",
        host.ssh_host.trim().trim_matches(['[', ']']),
        host.ssh_port
            .trim()
            .parse::<u16>()
            .map_err(|e| e.to_string())?
    ))
}

fn public_keys(output: &str) -> Vec<String> {
    output
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let kind = fields.next()?;
            let data = fields.next()?;
            if !matches!(
                kind,
                "ssh-ed25519"
                    | "ssh-rsa"
                    | "ecdsa-sha2-nistp256"
                    | "ecdsa-sha2-nistp384"
                    | "ecdsa-sha2-nistp521"
            ) || data.len() < 32
                || data.len() > 16384
                || !data
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"+/=".contains(&b))
            {
                return None;
            }
            Some(format!("{kind} {data}"))
        })
        .collect()
}

fn authorize(public_key: &str) -> String {
    let key = quote(&format!("{public_key} sshdeck-direct"));
    format!(
        r#"set -eu
umask 077
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
touch "$HOME/.ssh/authorized_keys"
chmod 600 "$HOME/.ssh/authorized_keys"
if ! grep -qxF -- {key} "$HOME/.ssh/authorized_keys"; then
  printf '\n%s\n' {key} >> "$HOME/.ssh/authorized_keys"
fi"#
    )
}

fn trust_target(host: &Host, keys: &[String]) -> Result<String, String> {
    let file = known_hosts_file(host)?;
    let address = host.ssh_host.trim().trim_matches(['[', ']']);
    let port = host
        .ssh_port
        .trim()
        .parse::<u16>()
        .map_err(|e| e.to_string())?;
    let address = if port == 22 {
        address.to_owned()
    } else {
        format!("[{address}]:{port}")
    };
    let lines = keys
        .iter()
        .map(|key| format!("{address} {key}\n"))
        .collect::<String>();
    // This file is owned by SSHDeck. The server keys came over the authenticated
    // target connection; never trust an unauthenticated ssh-keyscan result.
    Ok(format!(
        "set -eu; umask 077; printf '%s' {} > \"$HOME/.ssh/{file}\"",
        quote(&lines)
    ))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupOutcome {
    pub ready: bool,
    pub password_for: Option<String>,
    pub already_ready: bool,
}

enum Failure {
    Password(&'static str),
    Other(String),
}
impl From<String> for Failure {
    fn from(error: String) -> Self {
        Self::Other(error)
    }
}

fn run(endpoint: &Endpoint, script: &str, dir: &Path, cancel: &Cancel) -> Result<String, String> {
    let host = endpoint
        .host
        .as_ref()
        .ok_or("Direct mode requires two remote hosts")?;
    let argv = build_send_command(host, script, endpoint.password.is_some())?;
    let mut cmd = Command::new(&argv[0]);
    cmd.args(&argv[1..]).stdin(Stdio::null());
    no_window(&mut cmd);
    if let Some(password) = &endpoint.password {
        apply_askpass(&mut cmd, prepare_askpass_helper(dir)?, password);
    }
    let (status, output) = Worker::spawn(&mut cmd)?.wait(Duration::from_secs(45), cancel)?;
    if status.success() {
        Ok(output)
    } else {
        Err(output)
    }
}

fn authenticated(side: &'static str, result: Result<String, String>) -> Result<String, Failure> {
    result.map_err(|error| {
        let lower = error.to_ascii_lowercase();
        // An untrusted/changed host key must never turn into a password prompt.
        if !lower.contains("host key")
            && !lower.contains("host identification")
            && [
                "permission denied (",
                "authentication failed",
                "incorrect passphrase",
            ]
            .iter()
            .any(|s| lower.contains(s))
        {
            Failure::Password(side)
        } else {
            Failure::Other(format!("{side}: {error}"))
        }
    })
}

pub fn configure(
    source: &Endpoint,
    target: &Endpoint,
    dir: &Path,
    source_cancel: &Cancel,
    target_cancel: &Cancel,
) -> Result<SetupOutcome, String> {
    let host = target
        .host
        .as_ref()
        .ok_or("Direct mode requires two remote hosts")?;
    known_hosts_file(host)?;
    let result = provision(host, |side, script| {
        if side == "source" {
            run(source, script, dir, source_cancel)
        } else {
            run(target, script, dir, target_cancel)
        }
    });
    match result {
        Ok(already_ready) => Ok(SetupOutcome {
            ready: true,
            password_for: None,
            already_ready,
        }),
        Err(Failure::Password(side)) => Ok(SetupOutcome {
            ready: false,
            password_for: Some(side.into()),
            already_ready: false,
        }),
        Err(Failure::Other(error)) => Err(error),
    }
}

fn provision(
    host: &Host,
    mut execute: impl FnMut(&'static str, &str) -> Result<String, String>,
) -> Result<bool, Failure> {
    let verify = format!("printf 'quit\\n' | {{ {}; }}", direct_command(host)?);
    // This is read-only: an existing passwordless connection must exit here,
    // before creating keys or writing authorized_keys / known_hosts.
    if execute("source", &verify).is_ok() {
        return Ok(true);
    }
    // Verify authenticated target access and its host keys before creating a source key.
    let target_keys = public_keys(&authenticated("target", execute("target", TARGET_KEYS))?);
    if target_keys.is_empty() {
        return Err(Failure::Other("Cannot read target public host keys from /etc/ssh. Configure direct SSH access manually for this server / 无法读取目标服务器公用主机密钥，请手动配置直传连接".into()));
    }
    let source_key = public_keys(&authenticated("source", execute("source", SOURCE_KEY))?)
        .into_iter()
        .next()
        .ok_or("Cannot read source public key".to_string())?;
    authenticated("target", execute("target", &authorize(&source_key)))?;
    authenticated(
        "source",
        execute("source", &trust_target(host, &target_keys)?),
    )?;
    // The actual sftp handshake checks host identity, authentication and network reachability.
    execute("source", &verify).map_err(|error| {
        Failure::Other(format!(
            "Direct connection verification failed / 直传连接验证失败: {error}"
        ))
    })?;
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn working_direct_access_never_runs_any_key_or_trust_mutation() {
        let host = Host {
            ssh_host: "example.com".into(),
            ..Host::default()
        };
        let mut calls = 0;
        let result = provision(&host, |side, script| {
            calls += 1;
            assert_eq!(calls, 1, "only a single read-only preflight is allowed");
            assert_eq!(side, "source");
            for mutation in [
                "ssh-keygen",
                "authorized_keys",
                "mkdir",
                "printf '%s'",
                "> ",
            ] {
                assert!(!script.contains(mutation));
            }
            Ok(String::new())
        });
        assert!(matches!(result, Ok(true)));
        assert_eq!(calls, 1);
    }
    #[test]
    fn public_key_parser_ignores_banners_and_rejects_shell_fragments() {
        let data = "A".repeat(68);
        assert_eq!(
            public_keys(&format!("Welcome\nssh-ed25519 {data} comment\n")),
            vec![format!("ssh-ed25519 {data}")]
        );
        assert!(public_keys("ssh-ed25519 $(evil)").is_empty());
        assert!(public_keys("-----BEGIN OPENSSH PRIVATE KEY-----").is_empty());
        assert_eq!(quote("a'b"), "'a'\\''b'");
    }
    #[test]
    fn setup_never_turns_host_key_or_filesystem_errors_into_password_prompts() {
        assert!(matches!(
            authenticated("target", Err("Permission denied (publickey)".into())),
            Err(Failure::Password("target"))
        ));
        for error in [
            "Host key verification failed",
            "Permission denied",
            "Connection refused",
        ] {
            assert!(matches!(
                authenticated("source", Err(error.into())),
                Err(Failure::Other(_))
            ));
        }
    }
    #[test]
    fn trusted_target_file_is_scoped_and_uses_authenticated_public_keys() {
        let host = Host {
            ssh_host: "::1".into(),
            ssh_port: "2222".into(),
            ..Default::default()
        };
        let command = trust_target(&host, &[format!("ssh-ed25519 {}", "A".repeat(68))]).unwrap();
        assert!(command.contains("[::1]:2222 ssh-ed25519"));
        assert!(command.contains("sshdeck_known_hosts_::1_2222"));
        assert!(!command.contains("ssh-keyscan"));
        let invalid = Host {
            ssh_host: "host/$(bad)".into(),
            ..host
        };
        assert!(known_hosts_file(&invalid).is_err());
    }
    #[test]
    fn actual_shell_setup_keeps_private_key_on_source_and_deduplicates_authorization() {
        let root = std::env::temp_dir().join(format!("sshdeck-key-test-{}", uuid::Uuid::new_v4()));
        let source = root.join("source");
        let target = root.join("target");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::create_dir(&target).unwrap();
        let bash = std::path::PathBuf::from(
            std::env::var_os("ProgramFiles").unwrap_or_else(|| "C:\\Program Files".into()),
        )
        .join("Git/bin/bash.exe");
        let execute = |home: &Path, script: &str| {
            let mut command = Command::new(&bash);
            command
                .args(["--noprofile", "--norc", "-c", script])
                .env("HOME", home)
                .env_remove("BASH_ENV");
            no_window(&mut command);
            let output = command.output().unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            String::from_utf8(output.stdout).unwrap()
        };
        let public = public_keys(&execute(&source, SOURCE_KEY)).remove(0);
        let private = std::fs::read(source.join(".ssh/sshdeck_ed25519")).unwrap();
        assert!(String::from_utf8_lossy(&private).contains("OPENSSH PRIVATE KEY"));
        assert_eq!(
            public_keys(&execute(&source, SOURCE_KEY)),
            vec![public.clone()]
        );
        assert_eq!(
            std::fs::read(source.join(".ssh/sshdeck_ed25519")).unwrap(),
            private
        );
        // An existing last line without a newline must remain intact.
        std::fs::create_dir(target.join(".ssh")).unwrap();
        std::fs::write(target.join(".ssh/authorized_keys"), "existing-key").unwrap();
        execute(&target, &authorize(&public));
        execute(&target, &authorize(&public));
        let authorized = std::fs::read_to_string(target.join(".ssh/authorized_keys")).unwrap();
        assert!(authorized.starts_with("existing-key\n"));
        assert_eq!(authorized.matches(&public).count(), 1);
        assert!(!target.join(".ssh/sshdeck_ed25519").exists());
        let host = Host {
            ssh_host: "example.com".into(),
            ..Host::default()
        };
        execute(&source, &trust_target(&host, &[public]).unwrap());
        // Override sftp only within this shell to check the generated command's
        // identity, known-host file and stdin plumbing without a real server.
        let script = format!(
            r#"sftp() {{ printf '%s\n' "$@"; cat; }}; export -f sftp
printf 'quit\n' | {{ {}; }}"#,
            direct_command(&host).unwrap()
        );
        let output = execute(&source, &script);
        assert!(output.contains("sshdeck_ed25519"));
        assert!(output.contains("UserKnownHostsFile="));
        assert!(output.contains("StrictHostKeyChecking=yes"));
        assert!(output.ends_with("quit\n"));
        assert_eq!(root.parent(), Some(std::env::temp_dir().as_path()));
        assert!(root
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("sshdeck-key-test-"));
        std::fs::remove_dir_all(root).unwrap();
    }
}
