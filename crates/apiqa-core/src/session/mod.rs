use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Stopped,
    Starting,
    Capturing,
    Paused,
    Stopping,
    Failed,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureSession {
    pub id: Uuid,
    pub project_id: Option<Uuid>,
    pub device_serial: String,
    pub package_name: String,
    pub app_version: Option<String>,
    pub environment: Option<String>,
    pub status: SessionStatus,
    #[serde(with = "time::serde::rfc3339")]
    pub started_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub ended_at: Option<OffsetDateTime>,
}
