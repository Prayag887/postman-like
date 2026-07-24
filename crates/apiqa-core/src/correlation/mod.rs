use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CorrelationConfidence {
    Confirmed,
    High,
    Medium,
    Low,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InteractionWindow {
    pub id: Uuid,
    pub session_id: Uuid,
    #[serde(with = "time::serde::rfc3339")]
    pub started_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub ended_at: Option<OffsetDateTime>,
    pub foreground_package: Option<String>,
    pub foreground_activity: Option<String>,
    pub screen_label: Option<String>,
    pub trigger: InteractionTrigger,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InteractionTrigger {
    ActivityChanged,
    HierarchyChanged,
    RequestBurst,
    UserMarker,
    ProcessChanged,
}

pub fn correlate(
    transaction: &crate::traffic::HttpTransaction,
    incident: &crate::diagnostics::LogIncident,
    target_package: &str,
) -> CorrelationConfidence {
    let delta = (incident.occurred_at - transaction.updated_at)
        .whole_milliseconds()
        .unsigned_abs();
    let endpoint_mentioned = transaction
        .endpoint_identity
        .as_ref()
        .is_some_and(|endpoint| incident.message.contains(&endpoint.path_template));
    let app_frame = incident
        .first_app_frame
        .as_ref()
        .is_some_and(|frame| frame.contains(target_package));
    if delta <= 1500 && endpoint_mentioned && app_frame {
        CorrelationConfidence::Confirmed
    } else if delta <= 2500 && app_frame {
        CorrelationConfidence::High
    } else if delta <= 5000 {
        CorrelationConfidence::Medium
    } else {
        CorrelationConfidence::Low
    }
}
