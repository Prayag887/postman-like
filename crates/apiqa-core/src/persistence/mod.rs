//! SQLite metadata and content-addressed artifact persistence.
pub mod artifacts;
mod database;
pub mod migrations;
pub use database::{Database, StoreError};
