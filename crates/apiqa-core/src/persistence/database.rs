use crate::traffic::HttpTransaction;
use rusqlite::{Connection, params};
use std::{path::Path, sync::Mutex};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("database error: {0}")]
    Sql(#[from] rusqlite::Error),
    #[error("serialization error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("database lock poisoned")]
    Poisoned,
}
pub struct Database {
    connection: Mutex<Connection>,
}
impl Database {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let connection = Connection::open(path)?;
        super::migrations::apply(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }
    pub fn open_in_memory() -> Result<Self, StoreError> {
        let connection = Connection::open_in_memory()?;
        super::migrations::apply(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }
    fn connection(&self) -> Result<std::sync::MutexGuard<'_, Connection>, StoreError> {
        self.connection.lock().map_err(|_| StoreError::Poisoned)
    }
    pub fn upsert_transaction(&self, transaction: &HttpTransaction) -> Result<(), StoreError> {
        self.connection()?.execute(
            "INSERT INTO transactions(id,session_id,state,payload_json,created_at,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6) ON CONFLICT(id) DO UPDATE SET
             state=excluded.state,payload_json=excluded.payload_json,updated_at=excluded.updated_at",
            params![transaction.id.to_string(), transaction.session_id.to_string(),
                format!("{:?}", transaction.state), serde_json::to_string(transaction)?,
                transaction.created_at.to_string(), transaction.updated_at.to_string()])?;
        Ok(())
    }
    pub fn list_transactions(
        &self,
        session_id: Uuid,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<HttpTransaction>, StoreError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT payload_json FROM transactions WHERE session_id=?1 ORDER BY created_at DESC LIMIT ?2 OFFSET ?3")?;
        let rows = statement.query_map(
            params![session_id.to_string(), limit as i64, offset as i64],
            |row| row.get::<_, String>(0),
        )?;
        rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
    }
    pub fn get_transaction(&self, id: Uuid) -> Result<Option<HttpTransaction>, StoreError> {
        let connection = self.connection()?;
        let mut statement =
            connection.prepare("SELECT payload_json FROM transactions WHERE id=?1")?;
        let mut rows = statement.query([id.to_string()])?;
        rows.next()?
            .map(|row| Ok(serde_json::from_str(&row.get::<_, String>(0)?)?))
            .transpose()
    }
    pub fn approve_baseline(
        &self,
        endpoint_id: &str,
        transaction_id: Uuid,
    ) -> Result<(), StoreError> {
        self.connection()?.execute(
            "INSERT INTO approved_baselines(id,endpoint_id,transaction_id,approved_at,provenance_json)
             VALUES (?1,?2,?3,CURRENT_TIMESTAMP,'{\"source\":\"user\"}')",
            params![Uuid::new_v4().to_string(), endpoint_id, transaction_id.to_string()])?;
        Ok(())
    }
    pub fn migration_version(&self) -> Result<i64, StoreError> {
        Ok(self
            .connection()?
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get::<_, Option<i64>>(0)
            })?
            .unwrap_or_default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn schema_has_no_navigation_tables() {
        let db = Database::open_in_memory().unwrap();
        assert_eq!(db.migration_version().unwrap(), 2);
        let count: i64 = db.connection().unwrap().query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name LIKE 'navigation_%'", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 0);
    }
}
