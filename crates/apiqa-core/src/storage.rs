use std::{collections::HashSet, io::Cursor, path::Path, sync::Mutex};

use anyhow::{Context, Result, bail};
use chrono::{Duration, Utc};
use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest, Sha256};

use crate::{
    CleanupResult, Collection, ComparisonRule, Environment, RetentionPolicy, Run, RunState,
};

pub struct Store {
    connection: Mutex<Connection>,
}

impl Store {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let connection = Connection::open(path).context("open APIQA database")?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        let integrity: String = connection.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
        if integrity != "ok" {
            bail!("APIQA database integrity check failed: {integrity}");
        }
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS collections (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL, imported_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS runs (
                id TEXT PRIMARY KEY, collection_id TEXT NOT NULL, started_at TEXT NOT NULL,
                state TEXT NOT NULL, data TEXT NOT NULL,
                FOREIGN KEY(collection_id) REFERENCES collections(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_runs_collection_started ON runs(collection_id, started_at DESC);
            CREATE TABLE IF NOT EXISTS environments (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS response_blobs (
                hash TEXT PRIMARY KEY, compressed BLOB NOT NULL, original_bytes INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS comparison_rules (
                id TEXT NOT NULL, version INTEGER NOT NULL, scope_id TEXT NOT NULL,
                created_at TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(id, version)
            );
            CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        )?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn save_collection(&self, collection: &Collection) -> Result<()> {
        let json = serde_json::to_string(collection)?;
        self.connection.lock().expect("store lock").execute(
            "INSERT INTO collections(id,name,data,imported_at) VALUES(?1,?2,?3,?4)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name,data=excluded.data,imported_at=excluded.imported_at",
            params![collection.id, collection.name, json, collection.imported_at.to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn collections(&self) -> Result<Vec<Collection>> {
        let connection = self.connection.lock().expect("store lock");
        let mut statement =
            connection.prepare("SELECT data FROM collections ORDER BY imported_at DESC")?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
    }

    pub fn collection(&self, id: &str) -> Result<Option<Collection>> {
        let json = self
            .connection
            .lock()
            .expect("store lock")
            .query_row("SELECT data FROM collections WHERE id=?1", [id], |row| {
                row.get::<_, String>(0)
            })
            .optional()?;
        json.map(|value| serde_json::from_str(&value).context("decode collection"))
            .transpose()
    }

    pub fn save_environment(&self, environment: &Environment) -> Result<()> {
        let json = serde_json::to_string(environment)?;
        self.connection.lock().expect("store lock").execute(
            "INSERT INTO environments(id,name,data) VALUES(?1,?2,?3)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name,data=excluded.data",
            params![environment.id, environment.name, json],
        )?;
        Ok(())
    }

    pub fn environments(&self) -> Result<Vec<Environment>> {
        let connection = self.connection.lock().expect("store lock");
        let mut statement = connection.prepare("SELECT data FROM environments ORDER BY name")?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
    }

    pub fn save_run(&self, run: &Run) -> Result<()> {
        let mut stored = run.clone();
        let mut connection = self.connection.lock().expect("store lock");
        let transaction = connection.transaction()?;
        for execution in &mut stored.executions {
            if let Some(response) = execution.response.as_mut()
                && !response.body.is_empty()
            {
                let hash = format!("{:x}", Sha256::digest(response.body.as_bytes()));
                let compressed =
                    zstd::stream::encode_all(Cursor::new(response.body.as_bytes()), 3)?;
                transaction.execute(
                        "INSERT OR IGNORE INTO response_blobs(hash,compressed,original_bytes) VALUES(?1,?2,?3)",
                        params![hash, compressed, response.body.len() as i64],
                    )?;
                response.body_hash = Some(hash);
                response.body.clear();
            }
        }
        let json = serde_json::to_string(&stored)?;
        transaction.execute(
            "INSERT INTO runs(id,collection_id,started_at,state,data) VALUES(?1,?2,?3,?4,?5)
             ON CONFLICT(id) DO UPDATE SET state=excluded.state,data=excluded.data",
            params![
                run.id,
                run.collection_id,
                run.started_at.to_rfc3339(),
                format!("{:?}", run.state),
                json
            ],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn run(&self, id: &str) -> Result<Option<Run>> {
        let connection = self.connection.lock().expect("store lock");
        let json = connection
            .query_row("SELECT data FROM runs WHERE id=?1", [id], |row| {
                row.get::<_, String>(0)
            })
            .optional()?;
        json.map(|value| decode_run(&connection, &value))
            .transpose()
    }

    pub fn runs(&self, collection_id: Option<&str>) -> Result<Vec<Run>> {
        let connection = self.connection.lock().expect("store lock");
        let (sql, parameter) = match collection_id {
            Some(id) => (
                "SELECT data FROM runs WHERE collection_id=?1 ORDER BY started_at DESC",
                Some(id),
            ),
            None => ("SELECT data FROM runs ORDER BY started_at DESC", None),
        };
        let mut statement = connection.prepare(sql)?;
        let values = match parameter {
            Some(value) => statement
                .query_map([value], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?,
            None => statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?,
        };
        values
            .into_iter()
            .map(|value| decode_run(&connection, &value))
            .collect()
    }

    pub fn set_run_pinned(&self, id: &str, pinned: bool) -> Result<()> {
        let mut run = self.run(id)?.context("run not found")?;
        run.pinned = pinned;
        self.save_run(&run)
    }

    pub fn retention_policy(&self) -> Result<RetentionPolicy> {
        let value = self
            .connection
            .lock()
            .expect("store lock")
            .query_row(
                "SELECT value FROM settings WHERE key='retention'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        value
            .map(|json| serde_json::from_str(&json).context("decode retention policy"))
            .transpose()
            .map(|value| value.unwrap_or_default())
    }

    pub fn set_retention_policy(&self, policy: &RetentionPolicy) -> Result<()> {
        if !(7..=365).contains(&policy.days) {
            bail!("retention must be between 7 and 365 days");
        }
        self.connection.lock().expect("store lock").execute(
            "INSERT INTO settings(key,value) VALUES('retention',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [serde_json::to_string(policy)?],
        )?;
        Ok(())
    }

    pub fn cleanup_history(&self, policy: &RetentionPolicy) -> Result<CleanupResult> {
        let cutoff = (Utc::now() - Duration::days(policy.days as i64)).to_rfc3339();
        let mut connection = self.connection.lock().expect("store lock");
        let transaction = connection.transaction()?;
        let mut candidates = transaction
            .prepare("SELECT id,data FROM runs WHERE started_at < ?1 ORDER BY started_at")?;
        let rows = candidates
            .query_map([cutoff], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(candidates);
        let mut deleted_runs = 0;
        for (id, data) in rows {
            let run: Run = serde_json::from_str(&data)?;
            if !run.pinned && !matches!(run.state, RunState::Running) {
                deleted_runs += transaction.execute("DELETE FROM runs WHERE id=?1", [id])?;
            }
        }
        if let Some(max_bytes) = policy.max_bytes {
            let mut total = transaction.query_row(
                "SELECT COALESCE(SUM(length(compressed)),0) FROM response_blobs",
                [],
                |row| row.get::<_, i64>(0),
            )? as u64;
            if total > max_bytes {
                let mut oldest =
                    transaction.prepare("SELECT id,data FROM runs ORDER BY started_at")?;
                let extra = oldest
                    .query_map([], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                drop(oldest);
                for (id, data) in extra {
                    if total <= max_bytes {
                        break;
                    }
                    let run: Run = serde_json::from_str(&data)?;
                    if !run.pinned && !matches!(run.state, RunState::Running) {
                        deleted_runs +=
                            transaction.execute("DELETE FROM runs WHERE id=?1", [id])?;
                        total = referenced_compressed_bytes(&transaction)?;
                    }
                }
            }
        }
        let referenced = referenced_hashes(&transaction)?;
        let all_blobs = {
            let mut statement =
                transaction.prepare("SELECT hash,length(compressed) FROM response_blobs")?;
            statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as u64))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        let mut deleted_blobs = 0;
        let mut reclaimed_bytes = 0;
        for (hash, bytes) in all_blobs {
            if !referenced.contains(&hash) {
                deleted_blobs +=
                    transaction.execute("DELETE FROM response_blobs WHERE hash=?1", [hash])?;
                reclaimed_bytes += bytes;
            }
        }
        transaction.commit()?;
        Ok(CleanupResult {
            deleted_runs,
            deleted_blobs,
            reclaimed_bytes,
        })
    }

    pub fn save_comparison_rule(&self, rule: &ComparisonRule) -> Result<()> {
        self.connection.lock().expect("store lock").execute(
            "INSERT INTO comparison_rules(id,version,scope_id,created_at,data) VALUES(?1,?2,?3,?4,?5)",
            params![rule.id, rule.version, rule.scope_id, rule.created_at.to_rfc3339(), serde_json::to_string(rule)?],
        )?;
        Ok(())
    }

    pub fn comparison_rules(&self, scope_id: &str) -> Result<Vec<ComparisonRule>> {
        let connection = self.connection.lock().expect("store lock");
        let mut statement = connection
            .prepare("SELECT data FROM comparison_rules WHERE scope_id=?1 ORDER BY id,version")?;
        let rows = statement.query_map([scope_id], |row| row.get::<_, String>(0))?;
        rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
    }
}

fn decode_run(connection: &Connection, value: &str) -> Result<Run> {
    let mut run: Run = serde_json::from_str(value).context("decode run")?;
    for execution in &mut run.executions {
        if let Some(response) = execution.response.as_mut()
            && response.body.is_empty()
            && let Some(hash) = response.body_hash.as_deref()
        {
            let compressed = connection
                .query_row(
                    "SELECT compressed FROM response_blobs WHERE hash=?1",
                    [hash],
                    |row| row.get::<_, Vec<u8>>(0),
                )
                .optional()?;
            if let Some(bytes) = compressed {
                response.body = String::from_utf8(zstd::stream::decode_all(Cursor::new(bytes))?)
                    .context("response body is not UTF-8")?;
            }
        }
    }
    Ok(run)
}

fn referenced_hashes(connection: &Connection) -> Result<HashSet<String>> {
    let mut statement = connection.prepare("SELECT data FROM runs")?;
    let values = statement.query_map([], |row| row.get::<_, String>(0))?;
    let mut hashes = HashSet::new();
    for value in values {
        let run: Run = serde_json::from_str(&value?)?;
        for execution in run.executions {
            if let Some(hash) = execution.response.and_then(|response| response.body_hash) {
                hashes.insert(hash);
            }
        }
    }
    Ok(hashes)
}

fn referenced_compressed_bytes(connection: &Connection) -> Result<u64> {
    let hashes = referenced_hashes(connection)?;
    let mut total = 0;
    for hash in hashes {
        total += connection
            .query_row(
                "SELECT length(compressed) FROM response_blobs WHERE hash=?1",
                [hash],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .unwrap_or(0) as u64;
    }
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AssertionResult, ExecutionState, RequestExecution, ResponseSnapshot, RunState};
    use chrono::Utc;

    fn historical_run(id: &str, pinned: bool) -> Run {
        Run {
            id: id.into(),
            collection_id: "c1".into(),
            collection_name: "Demo".into(),
            environment_name: None,
            started_at: Utc::now() - Duration::days(60),
            completed_at: Some(Utc::now() - Duration::days(60)),
            state: RunState::Completed,
            baseline_run_id: None,
            pinned,
            executions: vec![RequestExecution {
                id: format!("e-{id}"),
                run_id: id.into(),
                request_id: "r1".into(),
                request_name: "Health".into(),
                state: ExecutionState::Passed,
                started_at: Utc::now() - Duration::days(60),
                response: Some(ResponseSnapshot {
                    status: 200,
                    headers: vec![],
                    content_type: Some("application/json".into()),
                    body: r#"{"ok":true}"#.into(),
                    body_hash: None,
                    body_size: 11,
                    duration_ms: 10,
                    truncated: false,
                }),
                error: None,
                comparison: None,
                assertions: Vec::<AssertionResult>::new(),
                extractions: vec![],
            }],
        }
    }

    #[test]
    fn deduplicates_bodies_and_preserves_pinned_runs() {
        let store = Store::open(":memory:").unwrap();
        store
            .save_collection(&Collection {
                id: "c1".into(),
                name: "Demo".into(),
                requests: vec![],
                variables: vec![],
                imported_at: Utc::now(),
                import_warnings: vec![],
            })
            .unwrap();
        store.save_run(&historical_run("run-1", false)).unwrap();
        store.save_run(&historical_run("run-2", true)).unwrap();
        let blob_count: i64 = store
            .connection
            .lock()
            .unwrap()
            .query_row("SELECT count(*) FROM response_blobs", [], |row| row.get(0))
            .unwrap();
        assert_eq!(blob_count, 1);
        assert_eq!(
            store.run("run-1").unwrap().unwrap().executions[0]
                .response
                .as_ref()
                .unwrap()
                .body,
            r#"{"ok":true}"#
        );

        let result = store.cleanup_history(&RetentionPolicy::default()).unwrap();
        assert_eq!(result.deleted_runs, 1);
        assert!(store.run("run-1").unwrap().is_none());
        assert!(store.run("run-2").unwrap().is_some());
        assert_eq!(result.deleted_blobs, 0);
    }
}
