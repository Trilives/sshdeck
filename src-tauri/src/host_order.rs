use std::cmp::Reverse;

use crate::model::Host;

/// Start legacy profiles in their previous visible order within each pin group.
pub fn initialize(hosts: &mut [Host]) {
    hosts.sort_by_key(|host| {
        (
            host.manual_order.unwrap_or(usize::MAX),
            Reverse(host.updated_at),
        )
    });
    for (index, host) in hosts.iter_mut().enumerate() {
        host.manual_order = Some(index);
    }
}

pub fn append(hosts: &mut Vec<Host>, mut host: Host) {
    host.manual_order = Some(
        hosts
            .last()
            .and_then(|last| last.manual_order)
            .map_or(0, |index| index + 1),
    );
    hosts.push(host);
}

pub fn sort_for_display(hosts: &mut [Host], auto_sort: bool) {
    hosts.sort_by_key(|host| {
        (
            Reverse(host.pinned),
            Reverse(if auto_sort { host.updated_at } else { 0 }),
        )
    });
}

pub fn move_host(hosts: &mut Vec<Host>, id: &str, target_id: &str) -> Result<(), String> {
    let from = hosts
        .iter()
        .position(|host| host.id == id)
        .ok_or("Host not found.")?;
    let to = hosts
        .iter()
        .position(|host| host.id == target_id)
        .ok_or("Target host not found.")?;
    if hosts[from].pinned != hosts[to].pinned {
        return Err("Hosts can only be reordered within the same pin group.".into());
    }

    let host = hosts.remove(from);
    hosts.insert(to, host);
    for (index, host) in hosts.iter_mut().enumerate() {
        host.manual_order = Some(index);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn host(id: &str, updated_at: i64, pinned: bool) -> Host {
        Host {
            id: id.into(),
            updated_at,
            pinned,
            ..Host::default()
        }
    }

    fn displayed_ids(hosts: &[Host], auto_sort: bool) -> Vec<String> {
        let mut sorted = hosts.to_vec();
        sort_for_display(&mut sorted, auto_sort);
        sorted.into_iter().map(|host| host.id).collect()
    }

    #[test]
    fn legacy_order_is_preserved_and_manual_moves_survive_edits_and_reload() {
        let mut hosts = vec![
            host("old", 1, false),
            host("pinned", 2, true),
            host("recent", 3, false),
        ];
        initialize(&mut hosts);
        assert_eq!(displayed_ids(&hosts, false), ["pinned", "recent", "old"]);
        assert!(move_host(&mut hosts, "old", "pinned").is_err());
        move_host(&mut hosts, "old", "recent").unwrap();
        append(&mut hosts, host("new", 4, false));

        let json = serde_json::to_string(&hosts).unwrap();
        let mut hosts: Vec<Host> = serde_json::from_str(&json).unwrap();
        initialize(&mut hosts);
        hosts
            .iter_mut()
            .find(|host| host.id == "recent")
            .unwrap()
            .updated_at = 5;
        assert_eq!(
            displayed_ids(&hosts, false),
            ["pinned", "old", "recent", "new"]
        );
        assert_eq!(
            displayed_ids(&hosts, true),
            ["pinned", "recent", "new", "old"]
        );
        assert_eq!(
            displayed_ids(&hosts, false),
            ["pinned", "old", "recent", "new"]
        );
    }
}
