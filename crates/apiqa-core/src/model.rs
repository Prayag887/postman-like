use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BodyKind {
    None,
    Raw,
    UrlEncoded,
    FormData,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct KeyValue {
    pub key: String,
    pub value: String,
    #[serde(default)]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ApiRequest {
    pub id: String,
    pub collection_id: String,
    pub folder_path: Vec<String>,
    pub name: String,
    pub method: String,
    pub url: String,
    pub headers: Vec<KeyValue>,
    pub query: Vec<KeyValue>,
    pub body_kind: BodyKind,
    pub body: Option<String>,
    #[serde(default)]
    pub auth: Auth,
    #[serde(default)]
    pub assertions: Vec<ResponseAssertion>,
    #[serde(default)]
    pub disabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Auth {
    #[default]
    None,
    Basic {
        username: String,
        password: String,
    },
    Bearer {
        token: String,
    },
    ApiKey {
        key: String,
        value: String,
        location: ApiKeyLocation,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ApiKeyLocation {
    Header,
    Query,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ResponseAssertion {
    StatusEquals { expected: u16, name: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AssertionResult {
    pub name: String,
    pub passed: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub requests: Vec<ApiRequest>,
    pub variables: Vec<KeyValue>,
    pub imported_at: DateTime<Utc>,
    pub import_warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Environment {
    pub id: String,
    pub name: String,
    pub variables: Vec<KeyValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ResponseSnapshot {
    pub status: u16,
    pub headers: Vec<KeyValue>,
    pub content_type: Option<String>,
    pub body: String,
    #[serde(default)]
    pub body_hash: Option<String>,
    pub body_size: u64,
    pub duration_ms: u64,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionState {
    Passed,
    Changed,
    AssertionFailed,
    TransportFailed,
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RequestExecution {
    pub id: String,
    pub run_id: String,
    pub request_id: String,
    pub request_name: String,
    pub state: ExecutionState,
    pub started_at: DateTime<Utc>,
    pub response: Option<ResponseSnapshot>,
    pub error: Option<String>,
    pub comparison: Option<ResponseComparison>,
    #[serde(default)]
    pub assertions: Vec<AssertionResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunState {
    Running,
    Completed,
    CompletedWithFindings,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Run {
    pub id: String,
    pub collection_id: String,
    pub collection_name: String,
    pub environment_name: Option<String>,
    pub started_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub state: RunState,
    pub baseline_run_id: Option<String>,
    pub executions: Vec<RequestExecution>,
    #[serde(default)]
    pub pinned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RetentionPolicy {
    pub days: u32,
    pub max_bytes: Option<u64>,
}

impl Default for RetentionPolicy {
    fn default() -> Self {
        Self {
            days: 30,
            max_bytes: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CleanupResult {
    pub deleted_runs: usize,
    pub deleted_blobs: usize,
    pub reclaimed_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ComparisonRule {
    pub id: String,
    pub version: u32,
    pub scope_id: String,
    pub ignored_json_paths: Vec<String>,
    pub ignored_headers: Vec<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DifferenceKind {
    Status,
    Header,
    Added,
    Removed,
    TypeChanged,
    ValueChanged,
    TextChanged,
    Timing,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Difference {
    pub kind: DifferenceKind,
    pub path: String,
    pub baseline: Option<Value>,
    pub current: Option<Value>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ResponseComparison {
    pub changed: bool,
    pub differences: Vec<Difference>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RunOptions {
    pub environment: Option<Environment>,
    pub baseline_run_id: Option<String>,
    #[serde(default = "default_timeout")]
    pub timeout_ms: u64,
    #[serde(default)]
    pub stop_on_error: bool,
    pub proxy_url: Option<String>,
    #[serde(default)]
    pub accept_invalid_certificates: bool,
}

fn default_timeout() -> u64 {
    30_000
}

impl Default for RunOptions {
    fn default() -> Self {
        Self {
            environment: None,
            baseline_run_id: None,
            timeout_ms: default_timeout(),
            stop_on_error: false,
            proxy_url: None,
            accept_invalid_certificates: false,
        }
    }
}
