//! Parse and write the local `~/.ssh/config`: on import, extract host connection parameters; on export, write hosts into a
//! block managed by this app (leaving the user's other existing entries untouched).

use std::path::PathBuf;

use uuid::Uuid;

use crate::model::Host;
use crate::util::now_millis;

const BLOCK_BEGIN: &str = "# >>> ssh-port-forwarder managed >>>";
const BLOCK_END: &str = "# <<< ssh-port-forwarder managed <<<";

/// Path to `~/.ssh/config`.
pub fn ssh_config_path() -> Result<PathBuf, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "Cannot locate user home directory.".to_string())?;
    Ok(PathBuf::from(home).join(".ssh").join("config"))
}

/// Parse ssh config text into a host list. Splits into blocks by `Host <alias>`, skipping wildcards (containing `*`/`?`).
pub fn parse_ssh_config(content: &str) -> Vec<Host> {
    let mut hosts: Vec<Host> = Vec::new();
    let mut current: Option<Host> = None;
    let mut alias = String::new();

    let flush = |hosts: &mut Vec<Host>, host: Option<Host>, alias: &str| {
        if let Some(mut host) = host {
            // Fall back to the alias itself when HostName is missing.
            if host.ssh_host.trim().is_empty() {
                host.ssh_host = alias.to_string();
            }
            hosts.push(host);
        }
    };

    for raw in content.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (key, value) = split_key_value(line);
        let key_lower = key.to_lowercase();
        if key_lower == "host" {
            // Finish off the previous block.
            flush(&mut hosts, current.take(), &alias);
            // Only take the first alias; skip the whole block if it contains a wildcard.
            let first = value.split_whitespace().next().unwrap_or("");
            if first.is_empty() || first.contains('*') || first.contains('?') {
                current = None;
                alias = String::new();
                continue;
            }
            alias = first.to_string();
            current = Some(Host {
                id: Uuid::new_v4().to_string(),
                name: alias.clone(),
                ssh_host: String::new(),
                ssh_port: "22".to_string(),
                ssh_user: String::new(),
                identity_file: String::new(),
                extra_options: String::new(),
                proxy_jump: String::new(),
                forwards: Vec::new(),
                pinned: false,
                updated_at: now_millis(),
                manual_order: None,
            });
            continue;
        }
        let Some(host) = current.as_mut() else {
            continue;
        };
        match key_lower.as_str() {
            "hostname" => host.ssh_host = value.to_string(),
            "user" => host.ssh_user = value.to_string(),
            "port" => host.ssh_port = value.to_string(),
            "identityfile" => host.identity_file = value.to_string(),
            "proxyjump" => host.proxy_jump = value.to_string(),
            _ => {}
        }
    }
    flush(&mut hosts, current.take(), &alias);
    hosts
}

/// The alias in SSH config's `Host <alias>` can't contain whitespace: ssh treats whitespace as a separator and splits it
/// into multiple patterns, which also breaks VS Code's `ssh-remote+<alias>` parsing. Replace whitespace with underscores.
pub fn sanitize_alias(alias: &str) -> String {
    alias
        .trim()
        .chars()
        .map(|ch| if ch.is_whitespace() { '_' } else { ch })
        .collect()
}

/// Find an alias whose explicit connection settings match this host.
/// Matching only `HostName` is unsafe: the same private IP can be reached directly and through a jump host.
pub fn find_alias_for_host(content: &str, expected: &Host) -> Option<String> {
    parse_ssh_config(content)
        .into_iter()
        .find(|candidate| {
            candidate.ssh_host.trim() == expected.ssh_host.trim()
                && effective_port(&candidate.ssh_port) == effective_port(&expected.ssh_port)
                && candidate.ssh_user.trim() == expected.ssh_user.trim()
                && candidate.identity_file.trim() == expected.identity_file.trim()
                && candidate.proxy_jump.trim() == expected.proxy_jump.trim()
                && !candidate.name.trim().is_empty()
        })
        .map(|host| host.name)
}

fn effective_port(port: &str) -> &str {
    let port = port.trim();
    if port.is_empty() {
        "22"
    } else {
        port
    }
}

/// Append a host entry to the end of the config (writes only non-empty, ssh-parsable fields), returning the new full text.
/// Leaves existing content untouched and doesn't interact with the managed block.
pub fn append_host_stanza(content: &str, alias: &str, host: &Host) -> String {
    let mut out = content.to_string();
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    out.push('\n');
    out.push_str("# added by ssh-port-forwarder\n");
    out.push_str(&format!("Host {}\n", sanitize_alias(alias)));
    if !host.ssh_host.trim().is_empty() {
        out.push_str(&format!("    HostName {}\n", host.ssh_host.trim()));
    }
    if !host.ssh_user.trim().is_empty() {
        out.push_str(&format!("    User {}\n", host.ssh_user.trim()));
    }
    if !host.ssh_port.trim().is_empty() && host.ssh_port.trim() != "22" {
        out.push_str(&format!("    Port {}\n", host.ssh_port.trim()));
    }
    if !host.identity_file.trim().is_empty() {
        out.push_str(&format!("    IdentityFile {}\n", host.identity_file.trim()));
    }
    if !host.proxy_jump.trim().is_empty() {
        out.push_str(&format!("    ProxyJump {}\n", host.proxy_jump.trim()));
    }
    out
}

/// `Key value` or `Key=value`; returns the unquoted value.
fn split_key_value(line: &str) -> (String, String) {
    let (key, rest) = match line.find(|c: char| c.is_whitespace() || c == '=') {
        Some(idx) => (line[..idx].to_string(), line[idx..].to_string()),
        None => (line.to_string(), String::new()),
    };
    let value = rest.trim_start_matches([' ', '\t', '=']).trim();
    let value = value.trim_matches('"');
    (key, value.to_string())
}

/// Render the host list into ssh config entries (writes only non-empty, ssh-parsable fields).
pub fn render_managed_block(hosts: &[Host]) -> String {
    let mut out = String::new();
    out.push_str(BLOCK_BEGIN);
    out.push('\n');
    for host in hosts {
        let raw_alias = if host.name.trim().is_empty() {
            host.ssh_host.trim()
        } else {
            host.name.trim()
        };
        let alias = sanitize_alias(raw_alias);
        if alias.is_empty() {
            continue;
        }
        out.push_str(&format!("Host {alias}\n"));
        if !host.ssh_host.trim().is_empty() {
            out.push_str(&format!("    HostName {}\n", host.ssh_host.trim()));
        }
        if !host.ssh_user.trim().is_empty() {
            out.push_str(&format!("    User {}\n", host.ssh_user.trim()));
        }
        if !host.ssh_port.trim().is_empty() && host.ssh_port.trim() != "22" {
            out.push_str(&format!("    Port {}\n", host.ssh_port.trim()));
        }
        if !host.identity_file.trim().is_empty() {
            out.push_str(&format!("    IdentityFile {}\n", host.identity_file.trim()));
        }
        if !host.proxy_jump.trim().is_empty() {
            out.push_str(&format!("    ProxyJump {}\n", host.proxy_jump.trim()));
        }
        out.push('\n');
    }
    out.push_str(BLOCK_END);
    out.push('\n');
    out
}

/// Extract the content outside the managed block (the user's own entries), used to exclude this app's managed part when deduplicating.
pub fn strip_managed_block(content: &str) -> String {
    let begin = content.find(BLOCK_BEGIN);
    let end = content.find(BLOCK_END);
    if let (Some(begin), Some(end)) = (begin, end) {
        if end > begin {
            let after = end + BLOCK_END.len();
            let tail = content[after..].strip_prefix('\n').unwrap_or(&content[after..]);
            let mut result = String::new();
            result.push_str(&content[..begin]);
            result.push_str(tail);
            return result;
        }
    }
    content.to_string()
}

/// Replace the existing managed block with the new one; append to the end of the file if there isn't one. Content outside the block is preserved as-is.
pub fn upsert_managed_block(existing: &str, block: &str) -> String {
    let begin = existing.find(BLOCK_BEGIN);
    let end = existing.find(BLOCK_END);
    if let (Some(begin), Some(end)) = (begin, end) {
        if end > begin {
            let after = end + BLOCK_END.len();
            // Also consume the single newline right after the block's end line.
            let tail = existing[after..].strip_prefix('\n').unwrap_or(&existing[after..]);
            let mut result = String::new();
            result.push_str(&existing[..begin]);
            result.push_str(block);
            result.push_str(tail);
            return result;
        }
    }
    let mut result = existing.to_string();
    if !result.is_empty() && !result.ends_with('\n') {
        result.push('\n');
    }
    if !result.is_empty() {
        result.push('\n');
    }
    result.push_str(block);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn expected_host(proxy_jump: &str) -> Host {
        Host {
            ssh_host: "10.0.0.8".to_string(),
            ssh_port: "22".to_string(),
            ssh_user: "dev".to_string(),
            proxy_jump: proxy_jump.to_string(),
            ..Host::default()
        }
    }

    #[test]
    fn exact_alias_does_not_reuse_same_ip_without_jump_host() {
        let config = "Host direct\n    HostName 10.0.0.8\n    User dev\n";
        assert_eq!(
            find_alias_for_host(config, &expected_host("jump@203.0.113.8")),
            None
        );
    }

    #[test]
    fn exact_alias_reuses_matching_jump_host() {
        let config =
            "Host via-jump\n    HostName 10.0.0.8\n    User dev\n    ProxyJump jump@203.0.113.8\n";
        assert_eq!(
            find_alias_for_host(config, &expected_host("jump@203.0.113.8")),
            Some("via-jump".to_string())
        );
    }
}
