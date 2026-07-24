use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
};
use thiserror::Error;
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArtifactRef {
    pub sha256: String,
    pub path: PathBuf,
    pub media_type: String,
    pub redacted: bool,
}
#[derive(Debug, Error)]
pub enum ArtifactError {
    #[error("artifact I/O failed: {0}")]
    Io(#[from] std::io::Error),
}
pub fn store(
    root: &Path,
    bytes: &[u8],
    media_type: &str,
    redacted: bool,
) -> Result<ArtifactRef, ArtifactError> {
    let sha256 = format!("{:x}", Sha256::digest(bytes));
    let path = root.join(&sha256);
    fs::create_dir_all(root)?;
    if !path.exists() {
        fs::write(&path, bytes)?;
    }
    Ok(ArtifactRef {
        sha256,
        path,
        media_type: media_type.to_owned(),
        redacted,
    })
}
