use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IssueCategory {
    ApiStatusChanged,
    ApiSchemaChanged,
    ApiValueChanged,
    ApiLatencyRegression,
    RequestContractChanged,
    DtoParsing,
    Crash,
    Anr,
    StrictMode,
    Database,
    WebView,
    Flutter,
    ReactNative,
    Jank,
    MemoryGrowth,
    NetworkFailure,
    CaptureFailure,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IssueSeverity {
    Critical,
    Warning,
    Informational,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Issue {
    pub id: Uuid,
    pub session_id: Uuid,
    pub category: IssueCategory,
    pub severity: IssueSeverity,
    pub confidence: crate::correlation::CorrelationConfidence,
    pub title: String,
    pub summary: String,
    pub transaction_id: Option<Uuid>,
    pub incident_id: Option<Uuid>,
    pub interaction_window_id: Option<Uuid>,
    pub endpoint: Option<crate::traffic::EndpointIdentity>,
    pub foreground_activity: Option<String>,
    pub relevant_logs: Vec<crate::diagnostics::FocusedLogLine>,
    pub differences: Vec<crate::comparison::Difference>,
    #[serde(with = "time::serde::rfc3339")]
    pub first_seen_at: OffsetDateTime,
    pub occurrence_count: u32,
}
