use regex::Regex;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IncidentCategory {
    Crash,
    Anr,
    DtoParsing,
    StrictMode,
    Database,
    WebView,
    Flutter,
    ReactNative,
    Jank,
    Memory,
    Network,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusedLogLine {
    pub timestamp_ms: i64,
    pub level: String,
    pub tag: String,
    pub message: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogIncident {
    pub id: Uuid,
    pub session_id: Uuid,
    pub category: IncidentCategory,
    pub signature: String,
    pub title: String,
    pub message: String,
    pub first_app_frame: Option<String>,
    pub lines: Vec<FocusedLogLine>,
    pub occurrence_count: u32,
    #[serde(with = "time::serde::rfc3339")]
    pub occurred_at: OffsetDateTime,
}

pub fn classify(message: &str) -> Option<(IncidentCategory, &'static str)> {
    let patterns = [
        (
            IncidentCategory::Crash,
            "Crash",
            r"(?i)FATAL EXCEPTION|uncaught exception|signal \d+ \(SIG",
        ),
        (
            IncidentCategory::Anr,
            "ANR",
            r"(?i)\bANR\b|not responding|input dispatching timed out",
        ),
        (
            IncidentCategory::DtoParsing,
            "DTO parsing failed",
            r#"(?i)JsonDataException|JsonSyntaxException|SerializationException|MismatchedInputException|Expected .+ but was|type ['"]?.+['"]? is not a subtype|type cast"#,
        ),
        (
            IncidentCategory::StrictMode,
            "StrictMode violation",
            r"(?i)StrictMode|DiskReadViolation|DiskWriteViolation|NetworkViolation|LeakedClosableViolation",
        ),
        (
            IncidentCategory::Database,
            "Database error",
            r"(?i)SQLiteConstraintException|SQLiteDatabaseLockedException|Room cannot verify|CursorWindow|database disk image is malformed|database or disk is full",
        ),
        (
            IncidentCategory::WebView,
            "WebView error",
            r"(?i)Render process gone|ERR_CERT_|mixed content|chromium.*uncaught",
        ),
        (
            IncidentCategory::Flutter,
            "Flutter runtime error",
            r"(?i)MissingPluginException|setState\(\) called after dispose|RenderFlex overflowed|Unhandled Exception",
        ),
        (
            IncidentCategory::ReactNative,
            "React Native error",
            r"(?i)ReactNativeJS.*Error|Hermes.*Error|native module.*error|Unable to load script",
        ),
        (
            IncidentCategory::Jank,
            "Jank detected",
            r"(?i)Skipped \d+ frames|Davey! duration=",
        ),
        (
            IncidentCategory::Network,
            "Network failure",
            r"(?i)UnknownHostException|ConnectException|SocketTimeoutException|SSLHandshakeException",
        ),
    ];
    patterns.into_iter().find_map(|(category, title, pattern)| {
        Regex::new(pattern)
            .ok()?
            .is_match(message)
            .then_some((category, title))
    })
}

pub fn normalize_signature(
    category: IncidentCategory,
    message: &str,
    frame: Option<&str>,
) -> String {
    let ids = Regex::new(r"\b(?:0x[0-9a-fA-F]+|\d{3,}|[0-9a-fA-F]{8}-[0-9a-fA-F-]{27})\b")
        .expect("valid regex");
    format!(
        "{category:?}|{}|{}",
        ids.replace_all(message, "{id}"),
        frame.unwrap_or("")
    )
}

pub fn first_application_frame(lines: &[FocusedLogLine], package: &str) -> Option<String> {
    lines
        .iter()
        .map(|line| line.message.trim())
        .find(|line| line.starts_with("at ") && line.contains(package) && !line.contains("$Proxy"))
        .map(str::to_owned)
}

pub fn parse_incident(
    session_id: Uuid,
    package: &str,
    lines: Vec<FocusedLogLine>,
) -> Option<LogIncident> {
    let root = lines
        .iter()
        .find_map(|line| classify(&line.message).map(|match_| (line, match_)))?;
    let frame = first_application_frame(&lines, package);
    Some(LogIncident {
        id: Uuid::new_v4(),
        session_id,
        category: root.1.0,
        signature: normalize_signature(root.1.0, &root.0.message, frame.as_deref()),
        title: root.1.1.into(),
        message: root.0.message.clone(),
        first_app_frame: frame,
        lines,
        occurrence_count: 1,
        occurred_at: OffsetDateTime::now_utc(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn classifies_actionable_logs_only() {
        assert_eq!(
            classify("kotlinx.serialization.SerializationException: missing field")
                .unwrap()
                .0,
            IncidentCategory::DtoParsing
        );
        assert!(classify("GC freed 123 objects").is_none());
    }
    #[test]
    fn signatures_deduplicate_ids() {
        assert_eq!(
            normalize_signature(IncidentCategory::Crash, "user 12345", None),
            normalize_signature(IncidentCategory::Crash, "user 98765", None)
        );
    }
}
