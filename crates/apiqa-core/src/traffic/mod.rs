use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use time::OffsetDateTime;
use url::Url;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransactionState {
    RequestStarted,
    RequestComplete,
    ResponseStarted,
    ResponseComplete,
    Failed,
    Cancelled,
    WebSocket,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "storage")]
pub enum BodyStorage {
    Empty,
    Inline {
        bytes: Vec<u8>,
    },
    Artifact {
        artifact_id: Uuid,
        preview: Vec<u8>,
        original_size: u64,
    },
    Truncated {
        preview: Vec<u8>,
        original_size: Option<u64>,
    },
    Unavailable {
        reason: String,
    },
}

impl BodyStorage {
    pub fn bytes(&self) -> Option<&[u8]> {
        match self {
            Self::Inline { bytes } => Some(bytes),
            Self::Artifact { preview, .. } | Self::Truncated { preview, .. } => Some(preview),
            Self::Empty => Some(&[]),
            Self::Unavailable { .. } => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HeaderEntry {
    pub name: String,
    pub value: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QueryParameter {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapturedRequest {
    pub method: String,
    pub scheme: String,
    pub host: String,
    pub port: Option<u16>,
    pub path: String,
    pub query: Vec<QueryParameter>,
    pub headers: Vec<HeaderEntry>,
    pub body: BodyStorage,
    pub content_type: Option<String>,
    pub http_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapturedResponse {
    pub status: u16,
    pub reason: Option<String>,
    pub headers: Vec<HeaderEntry>,
    pub body: BodyStorage,
    pub content_type: Option<String>,
    pub decoded_size: u64,
    pub encoded_size: u64,
    pub http_version: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TransactionTiming {
    pub request_started_ms: i64,
    pub request_complete_ms: Option<i64>,
    pub response_started_ms: Option<i64>,
    pub response_complete_ms: Option<i64>,
}

impl TransactionTiming {
    pub fn duration_ms(&self) -> Option<i64> {
        self.response_complete_ms
            .map(|end| end - self.request_started_ms)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EndpointIdentity {
    pub method: String,
    pub host: String,
    pub path_template: String,
    pub content_type: Option<String>,
    pub request_shape: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedCurl {
    pub compact: String,
    pub multiline: String,
    pub redacted: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CaptureQuality {
    Complete,
    PreviewOnly,
    MetadataOnly,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpTransaction {
    pub id: Uuid,
    pub session_id: Uuid,
    pub connection_id: Uuid,
    pub request: CapturedRequest,
    pub response: Option<CapturedResponse>,
    pub state: TransactionState,
    pub timing: TransactionTiming,
    pub endpoint_identity: Option<EndpointIdentity>,
    pub curl: Option<GeneratedCurl>,
    pub capture_quality: CaptureQuality,
    pub comparison: Option<crate::comparison::ResponseComparison>,
    pub correlated_incidents: Vec<Uuid>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
}

pub const SECRET_NAMES: &[&str] = &[
    "authorization",
    "proxy-authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "x-auth-token",
    "x-access-token",
    "x-refresh-token",
    "password",
    "passcode",
    "secret",
    "token",
    "access_token",
    "refresh_token",
    "api_key",
    "apikey",
    "session",
    "session_id",
    "otp",
    "pin",
    "private_key",
    "client_secret",
];

pub fn is_secret(name: &str) -> bool {
    SECRET_NAMES
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(name))
}

pub fn redact_headers(headers: &[HeaderEntry]) -> Vec<HeaderEntry> {
    headers
        .iter()
        .map(|header| HeaderEntry {
            name: header.name.clone(),
            value: if is_secret(&header.name) {
                "<redacted>".into()
            } else {
                header.value.clone()
            },
        })
        .collect()
}

pub fn redact_json(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, value) in map {
                if is_secret(key) {
                    *value = serde_json::Value::String("<redacted>".into());
                } else {
                    redact_json(value);
                }
            }
        }
        serde_json::Value::Array(values) => values.iter_mut().for_each(redact_json),
        _ => {}
    }
}

pub fn redact_url(input: &str) -> String {
    let Ok(mut url) = Url::parse(input) else {
        return input.to_owned();
    };
    let pairs = url
        .query_pairs()
        .map(|(key, value)| {
            let value = if is_secret(&key) {
                "<redacted>".into()
            } else {
                value
            };
            (key.into_owned(), value.into_owned())
        })
        .collect::<Vec<_>>();
    url.query_pairs_mut().clear().extend_pairs(pairs);
    url.to_string()
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

pub fn generate_curl(request: &CapturedRequest) -> GeneratedCurl {
    let mut url = format!(
        "{}://{}{}{}",
        request.scheme,
        request.host,
        request
            .port
            .map(|port| format!(":{port}"))
            .unwrap_or_default(),
        request.path
    );
    if !request.query.is_empty() {
        let query = request
            .query
            .iter()
            .map(|entry| {
                format!(
                    "{}={}",
                    url::form_urlencoded::byte_serialize(entry.name.as_bytes()).collect::<String>(),
                    url::form_urlencoded::byte_serialize(if is_secret(&entry.name) {
                        b"<redacted>"
                    } else {
                        entry.value.as_bytes()
                    })
                    .collect::<String>()
                )
            })
            .collect::<Vec<_>>()
            .join("&");
        url.push('?');
        url.push_str(&query);
    }
    let ignored = [
        "host",
        "content-length",
        "connection",
        "proxy-connection",
        "accept-encoding",
    ];
    let headers = redact_headers(&request.headers)
        .into_iter()
        .filter(|header| {
            !ignored
                .iter()
                .any(|name| header.name.eq_ignore_ascii_case(name))
        })
        .collect::<Vec<_>>();
    let mut args = vec![
        "curl".to_owned(),
        "--request".into(),
        request.method.clone(),
        "--url".into(),
        shell_quote(&url),
    ];
    for header in headers {
        args.extend([
            "--header".into(),
            shell_quote(&format!("{}: {}", header.name, header.value)),
        ]);
    }
    if let Some(body) = request.body.bytes().filter(|bytes| !bytes.is_empty()) {
        let body = String::from_utf8_lossy(body);
        args.extend(["--data-raw".into(), shell_quote(&body)]);
    }
    let compact = args.join(" ");
    let multiline = args
        .chunks(2)
        .enumerate()
        .map(|(index, chunk)| {
            let line = chunk.join(" ");
            if index == 0 {
                line
            } else {
                format!("  {line}")
            }
        })
        .collect::<Vec<_>>()
        .join(" \\\n");
    GeneratedCurl {
        compact,
        multiline,
        redacted: true,
    }
}

pub fn normalize_path(path: &str) -> String {
    let uuid = regex::Regex::new(r"(?i)^[0-9a-f]{8}-[0-9a-f-]{27}$").expect("valid uuid regex");
    let hex = regex::Regex::new(r"(?i)^[0-9a-f]{16,}$").expect("valid hex regex");
    path.split('/')
        .map(|segment| {
            if segment.parse::<u64>().is_ok() || uuid.is_match(segment) || hex.is_match(segment) {
                "{id}"
            } else {
                segment
            }
        })
        .collect::<Vec<_>>()
        .join("/")
}

pub fn request_shape(body: &BodyStorage) -> Option<String> {
    let value: serde_json::Value = serde_json::from_slice(body.bytes()?).ok()?;
    let object = value.as_object()?;
    let shape: BTreeMap<_, _> = object
        .iter()
        .map(|(key, value)| (key, json_type(value)))
        .collect();
    Some(
        blake3::hash(serde_json::to_string(&shape).ok()?.as_bytes())
            .to_hex()
            .to_string(),
    )
}

fn json_type(value: &serde_json::Value) -> &'static str {
    match value {
        serde_json::Value::Null => "null",
        serde_json::Value::Bool(_) => "boolean",
        serde_json::Value::Number(_) => "number",
        serde_json::Value::String(_) => "string",
        serde_json::Value::Array(_) => "array",
        serde_json::Value::Object(_) => "object",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn redacts_headers_and_nested_json() {
        assert_eq!(
            redact_headers(&[HeaderEntry {
                name: "Authorization".into(),
                value: "Bearer x".into()
            }])[0]
                .value,
            "<redacted>"
        );
        let mut value = serde_json::json!({"profile":{"password":"x","name":"safe"}});
        redact_json(&mut value);
        assert_eq!(value["profile"]["password"], "<redacted>");
    }
    #[test]
    fn escapes_curl_and_normalizes_routes() {
        assert_eq!(shell_quote("it's"), "'it'\"'\"'s'");
        assert_eq!(normalize_path("/users/847"), "/users/{id}");
        assert_eq!(normalize_path("/users/me"), "/users/me");
    }
}
