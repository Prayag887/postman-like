use rusqlite::{Connection, Result};

pub const INITIAL_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS environments (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, serial TEXT NOT NULL, metadata_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, project_id TEXT, device_id TEXT, package_name TEXT NOT NULL, app_version TEXT, environment_id TEXT, status TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT);
CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, state TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS transactions_session_time ON transactions(session_id, created_at DESC);
CREATE TABLE IF NOT EXISTS request_headers (transaction_id TEXT NOT NULL, ordinal INTEGER NOT NULL, name TEXT NOT NULL, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS response_headers (transaction_id TEXT NOT NULL, ordinal INTEGER NOT NULL, name TEXT NOT NULL, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS body_artifacts (id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL, direction TEXT NOT NULL, artifact_id TEXT);
CREATE TABLE IF NOT EXISTS endpoint_identities (id TEXT PRIMARY KEY, method TEXT NOT NULL, host TEXT NOT NULL, path_template TEXT NOT NULL, content_type TEXT, request_shape TEXT);
CREATE TABLE IF NOT EXISTS observations (id TEXT PRIMARY KEY, endpoint_id TEXT NOT NULL, transaction_id TEXT NOT NULL, environment_id TEXT, observed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS approved_baselines (id TEXT PRIMARY KEY, endpoint_id TEXT NOT NULL, transaction_id TEXT NOT NULL, approved_at TEXT NOT NULL, provenance_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS comparisons (id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL, baseline_transaction_id TEXT, compatibility TEXT NOT NULL, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS differences (id TEXT PRIMARY KEY, comparison_id TEXT NOT NULL, kind TEXT NOT NULL, path TEXT, severity TEXT NOT NULL, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS log_incidents (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, signature TEXT NOT NULL, payload_json TEXT NOT NULL, occurrence_count INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS interaction_windows (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS correlations (id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL, incident_id TEXT NOT NULL, confidence TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS performance_samples (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS issues (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, category TEXT NOT NULL, payload_json TEXT NOT NULL, occurrence_count INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS issue_occurrences (id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, occurred_at TEXT NOT NULL, evidence_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS redaction_rules (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS comparison_rules (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, endpoint_id TEXT, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, sha256 TEXT NOT NULL UNIQUE, blake3 TEXT NOT NULL, path TEXT NOT NULL, content_type TEXT NOT NULL, encoding TEXT, original_size INTEGER NOT NULL, stored_size INTEGER NOT NULL, redaction_status TEXT NOT NULL, created_at TEXT NOT NULL, retention_policy TEXT NOT NULL);
"#;

pub fn apply(connection: &Connection) -> Result<()> {
    connection.execute_batch(INITIAL_SCHEMA)?;
    connection.execute(
        "INSERT OR IGNORE INTO schema_migrations(version) VALUES (2)",
        [],
    )?;
    Ok(())
}
