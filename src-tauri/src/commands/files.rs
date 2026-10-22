use crate::{
    files::{
        filesystem::{FileSystem, Listing},
        jobs::{self, Job, Progress, Request},
        Endpoint, FileTransfers, Session,
    },
    state::AppState,
    util::lock_error,
};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

fn session(app: &AppHandle, id: &str) -> Result<Arc<Session>, String> {
    app.state::<FileTransfers>()
        .sessions
        .lock()
        .map_err(lock_error)?
        .get(id)
        .cloned()
        .ok_or_else(|| "File session disconnected / 文件连接已断开，请重新连接".into())
}

#[tauri::command]
pub async fn open_file_session(
    host_id: Option<String>,
    password: Option<String>,
    app: AppHandle,
) -> Result<Listing, String> {
    let host = host_id
        .as_deref()
        .map(|id| app.state::<AppState>().find_host(id))
        .transpose()?;
    if let Some(h) = &host {
        crate::validate::validate_host_connection(h)?;
    }
    let data_dir = app.state::<AppState>().data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let endpoint = Endpoint { host, password };
        let cancel = Arc::new(AtomicBool::new(false));
        let mut browser = FileSystem::connect(&endpoint, &data_dir, cancel.clone())?;
        let id = Uuid::new_v4().to_string();
        let listing = browser.listing(id.clone(), "")?;
        app.state::<FileTransfers>()
            .sessions
            .lock()
            .map_err(lock_error)?
            .insert(
                id,
                Arc::new(Session {
                    endpoint,
                    browser: Mutex::new(browser),
                    cancel,
                }),
            );
        Ok(listing)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn list_files(
    session_id: String,
    path: String,
    app: AppHandle,
) -> Result<Listing, String> {
    let s = session(&app, &session_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        s.browser
            .lock()
            .map_err(lock_error)?
            .listing(session_id, &path)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn close_file_session(session_id: String, app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let removed = app
            .state::<FileTransfers>()
            .sessions
            .lock()
            .map_err(lock_error)?
            .remove(&session_id);
        if let Some(session) = removed {
            session.cancel.store(true, Ordering::Relaxed);
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn start_file_transfer(request: Request, app: AppHandle) -> Result<Progress, String> {
    let source = session(&app, &request.source_session)?.endpoint.clone();
    let target = session(&app, &request.target_session)?.endpoint.clone();
    let job = Arc::new(Job::new(&source, &target, &request));
    let initial = jobs::snapshot(&job)?;
    {
        let transfers = app.state::<FileTransfers>();
        let mut list = transfers.jobs.lock().map_err(lock_error)?;
        if list.len() >= 200 {
            list.retain(|j| {
                j.progress
                    .lock()
                    .map(|p| ["queued", "scanning", "running"].contains(&p.status.as_str()))
                    .unwrap_or(true)
            });
        }
        if list.len() >= 200 {
            return Err("Too many queued transfers".into());
        }
        list.push(job.clone());
    }
    let data_dir = app.state::<AppState>().data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let transfers = app.state::<FileTransfers>();
        // One payload transfer at a time; directory browsers and cancellation remain independent.
        let result = (|| {
            let _guard = transfers.queue.lock().map_err(lock_error)?;
            jobs::run(&job, &request, &source, &target, &data_dir, Some(&app))
        })();
        job.update(Some(&app), |p| match result {
            Ok(()) => {
                p.status = "completed".into();
                p.speed = 0.;
            }
            Err(e) => {
                p.status = if job.cancel.load(Ordering::Relaxed) {
                    "cancelled"
                } else {
                    "failed"
                }
                .into();
                p.error = e;
                p.speed = 0.;
            }
        });
        if let Ok(p) = jobs::snapshot(&job) {
            app.state::<AppState>().add_log(
                if p.status == "failed" {
                    "error"
                } else {
                    "info"
                },
                format!(
                    "File transfer {} → {}: {} {}",
                    p.source, p.target, p.status, p.error
                ),
                Some(&app),
            );
        }
    });
    Ok(initial)
}
#[tauri::command]
pub fn list_file_transfers(state: State<FileTransfers>) -> Result<Vec<Progress>, String> {
    state
        .jobs
        .lock()
        .map_err(lock_error)?
        .iter()
        .map(|j| jobs::snapshot(j))
        .collect()
}
#[tauri::command]
pub fn cancel_file_transfer(
    id: String,
    state: State<FileTransfers>,
    app: AppHandle,
) -> Result<(), String> {
    let jobs = state.jobs.lock().map_err(lock_error)?;
    if let Some(job) = jobs
        .iter()
        .find(|j| j.progress.lock().map(|p| p.id == id).unwrap_or(false))
    {
        jobs::cancel(job);
        job.update(Some(&app), |p| {
            if p.status == "queued" {
                p.status = "cancelled".into();
            }
        });
    }
    Ok(())
}
