//! SiCode was KloudCode: its settings lived under the app id `ai.kloudcode.desktop`. On the first start
//! under `ai.sicode.desktop` they are copied over (the old folder stays as a backup), and the settings
//! files take the new names (`kloudcode.global.dat` becomes `sicode.global.dat`), so the EAD Pilot
//! sign-in, the open projects and the layout carry over.

use std::fs;
use std::io;
use std::path::Path;

const OLD: &str = "ai.kloudcode.";
const NEW: &str = "ai.sicode.";

/// Copies the old app's settings into `dir` (this app's data folder) when it has none yet.
pub fn migrate(dir: &Path) {
    let Some(name) = dir.file_name().and_then(|name| name.to_str()) else {
        return;
    };
    if !name.starts_with(NEW) {
        return;
    }
    let old = dir.with_file_name(name.replacen(NEW, OLD, 1));
    if !old.is_dir() || ["default.dat", "sicode.global.dat"].iter().any(|file| dir.join(file).exists()) {
        return;
    }
    match copy(&old, dir) {
        Ok(()) => tracing::info!(from = %old.display(), to = %dir.display(), "copied KloudCode settings to SiCode"),
        Err(err) => tracing::warn!(%err, "could not copy KloudCode settings"),
    }
}

fn copy(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        let name = match name.strip_prefix("kloudcode.") {
            Some(rest) => format!("sicode.{rest}"),
            None => name,
        };
        let target = to.join(name);
        if entry.file_type()?.is_dir() {
            copy(&entry.path(), &target)?;
            continue;
        }
        if !target.exists() {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("sicode-brand-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn copies_and_renames_the_old_settings_once() {
        let base = root("copy");
        let old = base.join("ai.kloudcode.desktop");
        fs::create_dir_all(old.join("nested")).unwrap();
        fs::write(old.join("default.dat"), "{\"token\":\"t\"}").unwrap();
        fs::write(old.join("kloudcode.global.dat"), "global").unwrap();
        fs::write(old.join("kloudcode.workspace.abc.1.dat"), "ws").unwrap();
        fs::write(old.join("nested").join("x"), "x").unwrap();
        let new = base.join("ai.sicode.desktop");

        migrate(&new);
        assert_eq!(fs::read_to_string(new.join("default.dat")).unwrap(), "{\"token\":\"t\"}");
        assert_eq!(fs::read_to_string(new.join("sicode.global.dat")).unwrap(), "global");
        assert_eq!(fs::read_to_string(new.join("sicode.workspace.abc.1.dat")).unwrap(), "ws");
        assert_eq!(fs::read_to_string(new.join("nested").join("x")).unwrap(), "x");
        assert!(!new.join("kloudcode.global.dat").exists());
        assert!(old.join("kloudcode.global.dat").exists());

        // Settings saved under the new name are never overwritten by a later start.
        fs::write(new.join("sicode.global.dat"), "newer").unwrap();
        migrate(&new);
        assert_eq!(fs::read_to_string(new.join("sicode.global.dat")).unwrap(), "newer");
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn leaves_other_folders_alone() {
        let base = root("other");
        fs::create_dir_all(base.join("ai.kloudcode.desktop")).unwrap();
        fs::write(base.join("ai.kloudcode.desktop").join("default.dat"), "x").unwrap();
        let other = base.join("com.example.app");
        migrate(&other);
        assert!(!other.exists());
        fs::remove_dir_all(base).unwrap();
    }
}
