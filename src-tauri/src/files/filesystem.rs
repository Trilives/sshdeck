use super::Endpoint;
use crate::ssh::{
    sftp::{Attrs, Sftp},
    worker::Cancel,
};
use serde::Serialize;
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

pub enum FileSystem {
    Local,
    Remote(Sftp),
}
pub enum Handle {
    Local(File),
    Remote(Vec<u8>),
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_link: bool,
    pub is_file: bool,
    pub size: u64,
    pub modified: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub session_id: String,
    pub path: String,
    pub entries: Vec<Entry>,
    pub roots: Vec<String>,
}

pub fn join(base: &str, name: &str, local: bool) -> Result<String, String> {
    validate_name(name, local)?;
    Ok(if local {
        Path::new(base).join(name).to_string_lossy().into_owned()
    } else {
        format!("{}/{}", base.trim_end_matches('/'), name)
    })
}

// A remote filename must never turn into a local path, drive, ADS or Windows device.
pub fn validate_name(name: &str, local: bool) -> Result<(), String> {
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\0']) {
        return Err(format!("Unsafe filename: {name:?}"));
    }
    if local {
        let stem = name.split('.').next().unwrap_or("").to_uppercase();
        if name.contains(['\\', ':', '*', '?', '"', '<', '>', '|'])
            || name.chars().any(|c| c < ' ')
            || name.ends_with(['.', ' '])
            || ["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"].contains(&stem.as_str())
            || ((stem.starts_with("COM") || stem.starts_with("LPT"))
                && stem.len() == 4
                && matches!(stem.as_bytes()[3], b'1'..=b'9'))
        {
            return Err(format!(
                "Filename is not supported on Windows / Windows 不支持此文件名: {name}"
            ));
        }
    }
    Ok(())
}
fn local_path(path: PathBuf) -> String {
    let s = path.to_string_lossy();
    if let Some(p) = s.strip_prefix("\\\\?\\UNC\\") {
        format!("\\\\{p}")
    } else {
        s.strip_prefix("\\\\?\\").unwrap_or(&s).to_string()
    }
}
fn attrs(meta: fs::Metadata) -> Attrs {
    Attrs {
        size: meta.len(),
        modified: meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0),
        permissions: if meta.is_symlink() {
            0o120777
        } else if meta.is_dir() {
            0o040755
        } else if meta.is_file() {
            0o100644
        } else {
            0
        },
    }
}
impl FileSystem {
    pub fn connect(endpoint: &Endpoint, data_dir: &Path, cancel: Cancel) -> Result<Self, String> {
        match &endpoint.host {
            Some(host) => Ok(Self::Remote(Sftp::connect(
                host,
                endpoint.password.as_deref(),
                data_dir,
                cancel,
            )?)),
            None => Ok(Self::Local),
        }
    }
    pub fn is_local(&self) -> bool {
        matches!(self, Self::Local)
    }
    pub fn realpath(&mut self, path: &str) -> Result<String, String> {
        match self {
            Self::Remote(s) => {
                let path = if path.is_empty() || path == "~" {
                    ".".into()
                } else if let Some(rest) = path.strip_prefix("~/") {
                    format!("{}/{rest}", s.realpath(".")?)
                } else {
                    path.into()
                };
                s.realpath(&path)
            }
            Self::Local => {
                let path = if path.is_empty() || path == "~" {
                    directories::UserDirs::new()
                        .ok_or("Cannot find user directory")?
                        .home_dir()
                        .to_path_buf()
                } else {
                    PathBuf::from(path)
                };
                fs::canonicalize(path)
                    .map(local_path)
                    .map_err(|e| e.to_string())
            }
        }
    }
    pub fn stat(&mut self, path: &str) -> Result<Option<Attrs>, String> {
        match self {
            Self::Remote(s) => s.stat(path),
            Self::Local => match fs::symlink_metadata(path) {
                Ok(m) => Ok(Some(attrs(m))),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
                Err(e) => Err(e.to_string()),
            },
        }
    }
    pub fn list(&mut self, path: &str) -> Result<Vec<Entry>, String> {
        let items: Vec<(String, Attrs)> = match self {
            Self::Remote(s) => s.list(path)?,
            Self::Local => fs::read_dir(path)
                .map_err(|e| e.to_string())?
                .map(|e| {
                    let e = e.map_err(|e| e.to_string())?;
                    let name = e
                        .file_name()
                        .into_string()
                        .map_err(|_| "Non-Unicode filename")?;
                    Ok((
                        name,
                        attrs(fs::symlink_metadata(e.path()).map_err(|e| e.to_string())?),
                    ))
                })
                .collect::<Result<_, String>>()?,
        };
        let mut result = items
            .into_iter()
            .map(|(name, a)| {
                Ok(Entry {
                    path: join(path, &name, self.is_local())?,
                    name,
                    is_dir: a.is_dir(),
                    is_link: a.is_link(),
                    is_file: a.is_file(),
                    size: a.size,
                    modified: a.modified,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        result.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(result)
    }
    pub fn listing(&mut self, session_id: String, path: &str) -> Result<Listing, String> {
        let path = self.realpath(path)?;
        if !self
            .stat(&path)?
            .is_some_and(|attrs| attrs.is_dir() && !attrs.is_link())
        {
            return Err(format!("Not a directory / 不是目录: {path}"));
        }
        let entries = self.list(&path)?;
        let roots = if self.is_local() {
            ('A'..='Z')
                .map(|d| format!("{d}:\\"))
                .filter(|p| Path::new(p).exists())
                .collect()
        } else {
            vec!["/".into()]
        };
        Ok(Listing {
            session_id,
            path,
            entries,
            roots,
        })
    }
    pub fn mkdir(&mut self, path: &str) -> Result<(), String> {
        if let Some(a) = self.stat(path)? {
            return if a.is_dir() && !a.is_link() {
                Ok(())
            } else {
                Err(format!("Not a regular directory: {path}"))
            };
        }
        match self {
            Self::Remote(s) => s.mkdir(path),
            Self::Local => fs::create_dir(path).map_err(|e| e.to_string()),
        }
    }
    pub fn open(&mut self, path: &str, write: bool) -> Result<Handle, String> {
        match self {
            Self::Remote(s) => s.open(path, write).map(Handle::Remote),
            Self::Local => if write {
                OpenOptions::new().write(true).create_new(true).open(path)
            } else {
                File::open(path)
            }
            .map(Handle::Local)
            .map_err(|e| e.to_string()),
        }
    }
    pub fn read(&mut self, h: &mut Handle, offset: u64, len: usize) -> Result<Vec<u8>, String> {
        match (self, h) {
            (Self::Remote(s), Handle::Remote(h)) => {
                if len <= crate::ssh::sftp::CHUNK {
                    s.read(h, offset, len)
                } else {
                    s.read_window(h, offset, len)
                }
            }
            (Self::Local, Handle::Local(f)) => {
                f.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
                let mut b = vec![0; len];
                let n = f.read(&mut b).map_err(|e| e.to_string())?;
                b.truncate(n);
                Ok(b)
            }
            _ => Err("Invalid handle".into()),
        }
    }
    pub fn write(&mut self, h: &mut Handle, offset: u64, b: &[u8]) -> Result<(), String> {
        match (self, h) {
            (Self::Remote(s), Handle::Remote(h)) => s.write_window(h, offset, b),
            (Self::Local, Handle::Local(f)) => {
                f.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
                f.write_all(b).map_err(|e| e.to_string())
            }
            _ => Err("Invalid handle".into()),
        }
    }
    pub fn close(&mut self, h: Handle) -> Result<(), String> {
        match (self, h) {
            (Self::Remote(s), Handle::Remote(h)) => s.close(&h),
            (_, Handle::Local(_)) => Ok(()),
            _ => Err("Invalid handle".into()),
        }
    }
    pub fn remove(&mut self, path: &str) -> Result<(), String> {
        match self {
            Self::Remote(s) => s.remove(path),
            Self::Local => fs::remove_file(path).map_err(|e| e.to_string()),
        }
    }
    pub fn commit(&mut self, temp: &str, path: &str, replace: bool) -> Result<(), String> {
        if let Some(a) = self.stat(path)? {
            if !replace || !a.is_file() {
                return Err(format!("Target already exists or is not a regular file / 目标已存在或不是普通文件: {path}"));
            }
        }
        match self {
            Self::Remote(s) => s.rename(temp, path, replace),
            Self::Local => fs::rename(temp, path).map_err(|e| e.to_string()),
        }
    }
    pub fn preserve(&mut self, path: &str, a: &Attrs) -> Result<(), String> {
        match self {
            Self::Remote(s) => s.set_attrs(path, a),
            Self::Local => {
                let f = OpenOptions::new()
                    .write(true)
                    .open(path)
                    .map_err(|e| e.to_string())?;
                f.set_modified(UNIX_EPOCH + std::time::Duration::from_secs(a.modified))
                    .map_err(|e| e.to_string())
            }
        }
    }
    pub fn reset_cancel(&mut self) {
        if let Self::Remote(s) = self {
            s.reset_cancel();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn listing_a_file_returns_error_and_keeps_session_usable() {
        let root = std::env::temp_dir().join(format!("sshdeck-listing-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let file = root.join("example.txt");
        fs::write(&file, "example").unwrap();
        let mut browser = FileSystem::Local;
        assert!(browser
            .listing("test".into(), file.to_str().unwrap())
            .err()
            .unwrap()
            .contains("Not a directory"));
        assert_eq!(
            browser
                .listing("test".into(), root.to_str().unwrap())
                .unwrap()
                .entries
                .len(),
            1
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn rejects_local_path_injection_and_devices() {
        for name in [
            "..",
            "a/b",
            "a\\b",
            "C:foo",
            "file:stream",
            "CON",
            "aux.txt",
            "LPT1.log",
            "a.",
            "a ",
        ] {
            assert!(validate_name(name, true).is_err(), "{name}");
        }
        assert!(validate_name("版本 1.zip", true).is_ok());
        assert!(validate_name("a\\b", false).is_ok());
    }
}
