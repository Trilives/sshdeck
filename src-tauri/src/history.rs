//! Pure logic for the local "open history": upsert/dedup entries, merge freshly-scanned VS Code history,
//! and sort a host's entries by recency. Persistence lives in `AppState`; this module is decoupled from Tauri.

use crate::model::HistoryEntry;

/// Cap on total stored history entries; the oldest are dropped past this.
const MAX_ENTRIES: usize = 500;

/// Identity of an entry within a single host, used to avoid duplicates:
/// One row per remote directory, one pathless terminal row per host, and one port row per bind/URL.
pub fn dedup_key(entry: &HistoryEntry) -> String {
    match entry.kind.as_str() {
        "vscode" | "terminal-path" if !entry.label.is_empty() => {
            let path = entry.label.trim_end_matches('/');
            format!("directory:{}", if path.is_empty() { "/" } else { path })
        }
        "vscode" => format!("vscode:{}", entry.uri),
        "terminal" => "terminal".to_string(),
        "port" => format!("port:{}", if entry.detail.is_empty() { &entry.label } else { &entry.detail }),
        other => format!("{other}:{}", entry.label),
    }
}

fn same_entry(existing: &HistoryEntry, entry: &HistoryEntry) -> bool {
    existing.host_id == entry.host_id
        && (dedup_key(existing) == dedup_key(entry)
            || (!entry.uri.is_empty()
                && existing.kind == "vscode"
                && entry.kind == "vscode"
                && existing.uri == entry.uri))
}

/// Insert a new entry, or bump the timestamp/label of an existing one with the same identity (per host).
pub fn upsert(list: &mut Vec<HistoryEntry>, entry: HistoryEntry) {
    if let Some(existing) = list
        .iter_mut()
        .find(|item| same_entry(item, &entry))
    {
        existing.opened_at = entry.opened_at;
        if !entry.label.is_empty() {
            existing.label = entry.label;
        }
        if !entry.uri.is_empty() {
            existing.uri = entry.uri;
            existing.kind = entry.kind;
        }
        if !entry.detail.is_empty() {
            existing.detail = entry.detail;
        }
    } else {
        list.push(entry);
    }
    prune(list);
}

/// Merge VS Code's own scanned history (uri, path) for a host: add any URI not already tracked locally.
/// Scanned paths have no exact launch time. Keep them below the most recent recorded directory
/// for this host while preserving their order.
pub fn merge_scanned(
    list: &mut Vec<HistoryEntry>,
    host_id: &str,
    scanned: &[(String, String)],
    now: i64,
    new_id: impl Fn() -> String,
) {
    let mut stamp = list
        .iter()
        .filter(|entry| {
            entry.host_id == host_id && matches!(entry.kind.as_str(), "vscode" | "terminal-path")
        })
        .map(|entry| entry.opened_at)
        .max()
        .map_or(now, |latest| latest.min(now));
    for (uri, path) in scanned {
        let mut entry = HistoryEntry {
            id: String::new(),
            host_id: host_id.to_string(),
            kind: "vscode".to_string(),
            label: path.clone(),
            uri: uri.clone(),
            detail: String::new(),
            opened_at: stamp - 1,
        };
        if let Some(existing) = list.iter_mut().find(|item| same_entry(item, &entry)) {
            if existing.uri.is_empty() {
                existing.uri = entry.uri;
                existing.kind = entry.kind;
            }
        } else {
            stamp -= 1;
            entry.id = new_id();
            list.push(entry);
        }
    }
    prune(list);
}

/// This host's entries, most recent first.
pub fn sorted_for_host(list: &[HistoryEntry], host_id: &str) -> Vec<HistoryEntry> {
    let mut entries: Vec<HistoryEntry> = list
        .iter()
        .filter(|item| item.host_id == host_id)
        .cloned()
        .collect();
    entries.sort_by(|a, b| b.opened_at.cmp(&a.opened_at));
    // Older builds could keep several VS Code aliases for a single directory.
    let mut seen = std::collections::HashSet::new();
    entries.retain(|entry| seen.insert(dedup_key(entry)));
    entries
}

/// Drop the oldest entries once the list exceeds the cap.
fn prune(list: &mut Vec<HistoryEntry>) {
    if list.len() > MAX_ENTRIES {
        list.sort_by(|a, b| b.opened_at.cmp(&a.opened_at));
        list.truncate(MAX_ENTRIES);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(host: &str, kind: &str, label: &str, uri: &str, at: i64) -> HistoryEntry {
        HistoryEntry {
            id: format!("{host}-{kind}-{label}"),
            host_id: host.to_string(),
            kind: kind.to_string(),
            label: label.to_string(),
            uri: uri.to_string(),
            detail: String::new(),
            opened_at: at,
        }
    }

    #[test]
    fn upsert_bumps_existing_terminal_instead_of_duplicating() {
        let mut list = Vec::new();
        upsert(&mut list, entry("h1", "terminal", "host-1", "", 100));
        upsert(&mut list, entry("h1", "terminal", "host-1", "", 200));
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].opened_at, 200);
    }

    #[test]
    fn vscode_dedups_by_uri_across_hosts() {
        let mut list = Vec::new();
        upsert(&mut list, entry("h1", "vscode", "/a", "uri-a", 100));
        upsert(&mut list, entry("h2", "vscode", "/a", "uri-a", 100));
        upsert(&mut list, entry("h1", "vscode", "/a", "uri-a", 300));
        assert_eq!(list.len(), 2); // same URI on two different hosts stays separate
    }

    #[test]
    fn merge_only_adds_unknown_uris_below_now() {
        let mut list = vec![entry("h1", "vscode", "/known", "uri-known", 500)];
        let scanned = vec![
            ("uri-known".to_string(), "/known".to_string()),
            ("uri-new".to_string(), "/new".to_string()),
        ];
        merge_scanned(&mut list, "h1", &scanned, 1000, || "gen".to_string());
        assert_eq!(list.len(), 2);
        let added = list.iter().find(|e| e.uri == "uri-new").unwrap();
        assert!(added.opened_at < 1000);
    }

    #[test]
    fn terminal_paths_move_to_the_top_without_losing_known_vscode_uris() {
        let mut list = vec![
            entry("h1", "vscode", "/work", "uri-work", 100),
            entry("h1", "vscode", "/other", "uri-other", 200),
        ];
        upsert(&mut list, entry("h1", "terminal-path", "/work/", "", 300));
        upsert(&mut list, entry("h1", "terminal-path", "/new", "", 250));
        merge_scanned(
            &mut list,
            "h1",
            &[("uri-new".into(), "/new".into()), ("uri-scanned".into(), "/scanned".into())],
            1000,
            || "gen".to_string(),
        );
        let recent = sorted_for_host(&list, "h1");
        assert_eq!(recent.len(), 4);
        assert_eq!((recent[0].opened_at, recent[0].uri.as_str()), (300, "uri-work"));
        assert_eq!((recent[2].opened_at, recent[2].uri.as_str()), (250, "uri-new"));
    }

    #[test]
    fn sorted_filters_by_host_and_orders_desc() {
        let mut list = Vec::new();
        upsert(&mut list, entry("h1", "vscode", "/a", "uri-a", 100));
        upsert(&mut list, entry("h1", "terminal", "host-1", "", 300));
        upsert(&mut list, entry("h2", "vscode", "/b", "uri-b", 400));
        let out = sorted_for_host(&list, "h1");
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].opened_at, 300);
        assert_eq!(out[1].opened_at, 100);
    }
}
