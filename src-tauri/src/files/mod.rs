pub mod filesystem;
pub mod jobs;

use crate::model::Host;
use filesystem::FileSystem;
use jobs::Job;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

#[derive(Clone)]
pub struct Endpoint {
    pub host: Option<Host>,
    pub password: Option<String>,
}
impl Endpoint {
    pub fn label(&self) -> String {
        self.host
            .as_ref()
            .map(|h| h.name.clone())
            .unwrap_or_else(|| "Local / 本机".into())
    }
    pub fn same_host(&self, other: &Self) -> bool {
        match (&self.host, &other.host) {
            (None, None) => true,
            (Some(a), Some(b)) => {
                a.ssh_host.eq_ignore_ascii_case(&b.ssh_host)
                    && a.ssh_user == b.ssh_user
                    && a.ssh_port == b.ssh_port
            }
            _ => false,
        }
    }
}
pub struct Session {
    pub endpoint: Endpoint,
    pub browser: Mutex<FileSystem>,
    pub cancel: crate::ssh::worker::Cancel,
}

#[derive(Default)]
pub struct FileTransfers {
    pub sessions: Mutex<HashMap<String, Arc<Session>>>,
    pub jobs: Mutex<Vec<Arc<Job>>>,
    pub queue: Mutex<()>,
}

impl FileTransfers {
    pub fn active_count(&self) -> usize {
        self.jobs
            .lock()
            .map(|jobs| {
                jobs.iter()
                    .filter(|j| {
                        j.progress
                            .lock()
                            .map(|p| ["queued", "scanning", "running"].contains(&p.status.as_str()))
                            .unwrap_or(false)
                    })
                    .count()
            })
            .unwrap_or(0)
    }
    pub fn cancel_all(&self) {
        if let Ok(jobs) = self.jobs.lock() {
            for job in jobs.iter() {
                jobs::cancel(job);
            }
        }
        if let Ok(sessions) = self.sessions.lock() {
            for session in sessions.values() {
                session
                    .cancel
                    .store(true, std::sync::atomic::Ordering::Relaxed);
            }
        }
    }
}
