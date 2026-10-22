use directories::BaseDirs;
use std::path::{Path, PathBuf};

const APP_DIRECTORY: &str = "SSHDeck";
const DATA_DIRECTORY: &str = "data";

pub fn resolve() -> PathBuf {
    // Local UI smoke tests use an isolated profile. Release builds always use the normal data folder.
    #[cfg(debug_assertions)]
    if let Some(path) = std::env::var_os("SSHDECK_TEST_DATA_DIR").map(PathBuf::from) {
        if path.is_absolute() {
            return path;
        }
    }
    BaseDirs::new()
        .map(|dirs| under_local_data(dirs.data_local_dir()))
        .unwrap_or_else(|| under_local_data(&std::env::temp_dir()))
}

fn under_local_data(root: &Path) -> PathBuf {
    root.join(APP_DIRECTORY).join(DATA_DIRECTORY)
}

#[cfg(test)]
mod tests {
    use super::under_local_data;
    use std::path::Path;

    #[test]
    fn appends_brand_only_storage_path() {
        let path = under_local_data(Path::new("local-data"));
        assert_eq!(path, Path::new("local-data").join("SSHDeck").join("data"));
    }
}
