use std::path::PathBuf;

use serde::Serialize;
use specta::Type;

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SharedServerKey {
    /// OpenSSH public key line, sent to EAD Pilot to put on the server.
    pub public_key: String,
    /// Private key file on this computer, for `ssh -i`.
    pub path: String,
}

fn key_path(server_id: u32) -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not find the home folder.")?;
    Ok(home.join(".ssh").join(format!("sicode_ead_s{server_id}_ed25519")))
}

/// The key pair for one Shared AI Coding Server, made with the system's ssh-keygen the first
/// time. The private key never leaves this computer.
#[tauri::command]
#[specta::specta]
pub async fn shared_server_key(server_id: u32) -> Result<SharedServerKey, String> {
    let path = key_path(server_id)?;
    // ssh-keygen writes the public half next to it as <path>.pub.
    let public = PathBuf::from(format!("{}.pub", path.display()));

    if !path.exists() || !public.exists() {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("Could not make {}: {e}", dir.display()))?;
        }
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(&public);
        let mut cmd = tokio::process::Command::new("ssh-keygen");
        cmd.arg("-q")
            .args(["-t", "ed25519"])
            .args(["-N", ""])
            .args(["-C", &format!("sicode-ead-s{server_id}")])
            .arg("-f")
            .arg(&path);
        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let out = cmd
            .output()
            .await
            .map_err(|e| format!("Could not run ssh-keygen. Install the OpenSSH client. ({e})"))?;
        if !out.status.success() {
            return Err(format!(
                "ssh-keygen failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
    }

    let public_key = std::fs::read_to_string(&public)
        .map_err(|e| format!("Could not read {}: {e}", public.display()))?
        .trim()
        .to_string();
    Ok(SharedServerKey {
        public_key,
        path: path.display().to_string(),
    })
}
