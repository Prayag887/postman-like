use std::{path::Path, sync::Mutex};

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, params};

use crate::{Collection, Run};

pub struct Store {
    connection: Mutex<Connection>,
}

impl Store {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let connection = Connection::open(path).context("open APIQA database")?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS collections (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                data TEXT NOT NULL,
                imported_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS runs (
                id TEXT PRIMARY KEY,
                collection_id TEXT NOT NULL,
                started_at TEXT NOT NULL,
                state TEXT NOT NULL,
                data TEXT NOT NULL,
                FOREIGN KEY(collection_id) REFERENCES collections(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_runs_collection_started
              ON runs(collection_id, started_at DESC);",
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

    pub fn save_run(&self, run: &Run) -> Result<()> {
        let json = serde_json::to_string(run)?;
        self.connection.lock().expect("store lock").execute(
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
        Ok(())
    }

    pub fn run(&self, id: &str) -> Result<Option<Run>> {
        let json = self
            .connection
            .lock()
            .expect("store lock")
            .query_row("SELECT data FROM runs WHERE id=?1", [id], |row| {
                row.get::<_, String>(0)
            })
            .optional()?;
        json.map(|value| serde_json::from_str(&value).context("decode run"))
            .transpose()
    }

    pub fn runs(&self, collection_id: Option<&str>) -> Result<Vec<Run>> {
        let connection = self.connection.lock().expect("store lock");
        let (sql, parameter): (&str, Option<&str>) = match collection_id {
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
            .map(|value| serde_json::from_str(&value).context("decode run"))
            .collect()
    }
}
