use std::fs;

use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::{host_order, model::Host};
use crate::sshconfig::{
    parse_ssh_config, render_managed_block, ssh_config_path, strip_managed_block,
    upsert_managed_block,
};
use crate::state::AppState;
use crate::store::write_json;
use crate::util::{lock_error, now_millis};

/// Export file format: a version-tagged wrapper around the host list (including forwards and ports, re-importable).
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportBundle {
    version: String,
    hosts: Vec<Host>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    /// "done" or "conflict".
    pub status: String,
    pub duplicates: Vec<String>,
    pub added: usize,
    pub overwritten: usize,
    pub skipped: usize,
}

fn dedup_key(host: &Host) -> String {
    host.ssh_host.trim().to_lowercase()
}

/// Pick a file, read it, and parse it into a host list (for the frontend to select); returns an empty list if the user cancels.
#[tauri::command]
pub fn read_import_file() -> Result<Vec<Host>, String> {
    let Some(path) = FileDialog::new()
        .add_filter("SSHDeck", &["json"])
        .add_filter("All files", &["*"])
        .pick_file()
    else {
        return Ok(Vec::new());
    };
    let content = fs::read_to_string(&path).map_err(|err| err.to_string())?;
    // Support both the version-tagged wrapper and a bare array format.
    if let Ok(bundle) = serde_json::from_str::<ExportBundle>(&content) {
        return Ok(bundle.hosts);
    }
    serde_json::from_str::<Vec<Host>>(&content)
        .map_err(|err| format!("Invalid import file: {err}"))
}

/// Read the local `~/.ssh/config` and parse it into a host list (for the frontend to select).
#[tauri::command]
pub fn read_import_ssh_config() -> Result<Vec<Host>, String> {
    let path = ssh_config_path()?;
    if !path.exists() {
        return Err(format!("SSH config not found: {}", path.display()));
    }
    let content = fs::read_to_string(&path).map_err(|err| err.to_string())?;
    Ok(parse_ssh_config(&content))
}

/// Merge the selected hosts into the existing list. strategy: "" detects conflicts, "overwrite" overwrites, "skip" imports only non-duplicates.
#[tauri::command]
pub fn import_hosts(
    hosts: Vec<Host>,
    strategy: String,
    state: State<AppState>,
    app: AppHandle,
) -> Result<ImportResult, String> {
    // First dedup the incoming list itself by IP (keep the first occurrence).
    let mut incoming: Vec<Host> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for host in hosts {
        if dedup_key(&host).is_empty() {
            continue;
        }
        if seen.insert(dedup_key(&host)) {
            incoming.push(host);
        }
    }

    let mut existing = state.hosts.lock().map_err(lock_error)?;
    let existing_keys: std::collections::HashSet<String> =
        existing.iter().map(dedup_key).collect();

    let duplicates: Vec<String> = incoming
        .iter()
        .filter(|host| existing_keys.contains(&dedup_key(host)))
        .map(|host| host.name.clone())
        .collect();

    if strategy.is_empty() && !duplicates.is_empty() {
        return Ok(ImportResult {
            status: "conflict".to_string(),
            duplicates,
            added: 0,
            overwritten: 0,
            skipped: 0,
        });
    }

    let mut added = 0;
    let mut overwritten = 0;
    let mut skipped = 0;
    let now = now_millis();

    for mut host in incoming {
        let key = dedup_key(&host);
        if let Some(pos) = existing.iter().position(|item| dedup_key(item) == key) {
            // Conflicts with an existing host's IP.
            if strategy == "overwrite" {
                let target = &mut existing[pos];
                target.name = host.name.clone();
                target.ssh_host = host.ssh_host.clone();
                target.ssh_user = host.ssh_user.clone();
                target.ssh_port = host.ssh_port.clone();
                target.identity_file = host.identity_file.clone();
                target.extra_options = host.extra_options.clone();
                target.proxy_jump = host.proxy_jump.clone();
                // Only replace forwards if the incoming host has any (a config import has none → keep the existing ones).
                if !host.forwards.is_empty() {
                    target.forwards = host.forwards.clone();
                }
                target.updated_at = now;
                overwritten += 1;
            } else {
                skipped += 1;
            }
        } else {
            // New host: assign a new id to avoid colliding with existing or sibling entries.
            host.id = Uuid::new_v4().to_string();
            host.updated_at = now;
            host_order::append(&mut existing, host);
            added += 1;
        }
    }

    write_json(state.hosts_path(), &*existing)?;
    drop(existing);
    state.add_log(
        "info",
        format!("hosts imported: +{added} ~{overwritten} skip{skipped}"),
        Some(&app),
    );
    Ok(ImportResult {
        status: "done".to_string(),
        duplicates: Vec::new(),
        added,
        overwritten,
        skipped,
    })
}

fn selected_hosts(state: &AppState, host_ids: &[String]) -> Result<Vec<Host>, String> {
    let hosts = state.hosts.lock().map_err(lock_error)?;
    Ok(hosts
        .iter()
        .filter(|host| host_ids.iter().any(|id| id == &host.id))
        .cloned()
        .collect())
}

/// Export the selected hosts to a chosen file (including forwards and ports, re-importable). Returns false if canceled.
#[tauri::command]
pub fn export_hosts_to_file(
    host_ids: Vec<String>,
    state: State<AppState>,
    app: AppHandle,
) -> Result<bool, String> {
    let hosts = selected_hosts(state.inner(), &host_ids)?;
    let Some(path) = FileDialog::new()
        .add_filter("SSHDeck", &["json"])
        .set_file_name("sshdeck-hosts.json")
        .save_file()
    else {
        return Ok(false);
    };
    let bundle = ExportBundle {
        version: env!("CARGO_PKG_VERSION").to_string(),
        hosts,
    };
    let json = serde_json::to_string_pretty(&bundle).map_err(|err| err.to_string())?;
    fs::write(&path, json).map_err(|err| err.to_string())?;
    state.add_log("info", format!("hosts exported to {}", path.display()), Some(&app));
    Ok(true)
}

/// Export the selected hosts into a managed block in the local `~/.ssh/config` (only ssh-parsable fields).
/// Deduplicates by IP the same way import does: a duplicate means an IP collision with the user's own entries outside the managed block.
/// strategy: "" detects conflicts, "overwrite" writes all, "skip" writes only non-duplicates.
#[tauri::command]
pub fn export_hosts_to_ssh_config(
    host_ids: Vec<String>,
    strategy: String,
    state: State<AppState>,
    app: AppHandle,
) -> Result<ImportResult, String> {
    let hosts = selected_hosts(state.inner(), &host_ids)?;
    let path = ssh_config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let existing = fs::read_to_string(&path).unwrap_or_default();
    // The managed block is wholly rewritten by this app, so it doesn't count as a conflict; only dedup against entries outside it.
    let outside_ips: std::collections::HashSet<String> = parse_ssh_config(&strip_managed_block(&existing))
        .iter()
        .map(dedup_key)
        .filter(|key| !key.is_empty())
        .collect();

    let duplicates: Vec<String> = hosts
        .iter()
        .filter(|host| outside_ips.contains(&dedup_key(host)))
        .map(|host| host.name.clone())
        .collect();

    if strategy.is_empty() && !duplicates.is_empty() {
        return Ok(ImportResult {
            status: "conflict".to_string(),
            duplicates,
            added: 0,
            overwritten: 0,
            skipped: 0,
        });
    }

    let mut to_write: Vec<Host> = Vec::new();
    let mut added = 0;
    let mut overwritten = 0;
    let mut skipped = 0;
    for host in &hosts {
        if outside_ips.contains(&dedup_key(host)) {
            if strategy == "overwrite" {
                to_write.push(host.clone());
                overwritten += 1;
            } else {
                skipped += 1;
            }
        } else {
            to_write.push(host.clone());
            added += 1;
        }
    }

    let block = render_managed_block(&to_write);
    let updated = upsert_managed_block(&existing, &block);
    fs::write(&path, updated).map_err(|err| err.to_string())?;
    state.add_log(
        "info",
        format!("hosts exported to ssh config: +{added} ~{overwritten} skip{skipped}"),
        Some(&app),
    );
    Ok(ImportResult {
        status: "done".to_string(),
        duplicates: Vec::new(),
        added,
        overwritten,
        skipped,
    })
}
