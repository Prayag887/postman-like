use std::{env, fs, path::PathBuf};

use anyhow::{Context, Result, bail};
use apiqa_core::{ApiQaEngine, RunOptions, Store, import_postman};

#[tokio::main]
async fn main() -> Result<()> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    let data_dir = env::var_os("APIQA_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(".apiqa"));
    fs::create_dir_all(&data_dir)?;
    let engine = ApiQaEngine::new(Store::open(data_dir.join("apiqa.db"))?);
    match args.as_slice() {
        [command, path] if command == "import" => {
            let source = fs::read_to_string(path).with_context(|| format!("read {path}"))?;
            let collection = import_postman(&source)?;
            engine.store.save_collection(&collection)?;
            println!(
                "Imported {} ({} requests)",
                collection.name,
                collection.requests.len()
            );
        }
        [command, collection_id] if command == "run" => {
            let collection = engine
                .store
                .collection(collection_id)?
                .context("collection not found")?;
            let run = engine
                .run_collection(&collection, RunOptions::default())
                .await?;
            println!("{}", serde_json::to_string_pretty(&run)?);
            if matches!(run.state, apiqa_core::RunState::Failed) {
                std::process::exit(4);
            }
            if matches!(run.state, apiqa_core::RunState::CompletedWithFindings) {
                std::process::exit(2);
            }
        }
        [command] if command == "collections" => {
            println!(
                "{}",
                serde_json::to_string_pretty(&engine.store.collections()?)?
            );
        }
        _ => bail!("usage: apiqa import <postman.json> | run <collection-id> | collections"),
    }
    Ok(())
}
