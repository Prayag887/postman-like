use std::{
    env, fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, bail};
use apiqa_core::{
    ApiQaEngine, ExecutionState, RunOptions, Store, export_project, html_report, import_postman,
    import_postman_environment, import_project, json_report, junit_report,
};

#[tokio::main]
async fn main() -> Result<()> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    let data_dir = env::var_os("APIQA_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(".apiqa"));
    fs::create_dir_all(&data_dir)?;
    let engine = ApiQaEngine::new(Store::open(data_dir.join("apiqa.db"))?);
    match args.first().map(String::as_str) {
        Some("import") => {
            let path = args.get(1).context("missing Postman collection path")?;
            let source = fs::read_to_string(path).with_context(|| format!("read {path}"))?;
            let collection = import_postman(&source)?;
            engine.store.save_collection(&collection)?;
            println!(
                "Imported {} ({} requests, {} warnings)",
                collection.name,
                collection.requests.len(),
                collection.import_warnings.len()
            );
        }
        Some("import-environment") => {
            let path = args.get(1).context("missing Postman environment path")?;
            let source = fs::read_to_string(path).with_context(|| format!("read {path}"))?;
            let environment = import_postman_environment(&source)?;
            engine.store.save_environment(&environment)?;
            println!("Imported environment {}", environment.name);
        }
        Some("run") => {
            let collection_id = args.get(1).context("missing collection ID")?;
            let collection = engine
                .store
                .collection(collection_id)?
                .context("collection not found")?;
            let environment = flag_value(&args, "--environment")
                .map(|id| {
                    engine
                        .store
                        .environments()
                        .map(|items| items.into_iter().find(|item| item.id == id))
                })
                .transpose()?
                .flatten();
            let run = engine
                .run_collection(
                    &collection,
                    RunOptions {
                        environment,
                        baseline_run_id: flag_value(&args, "--baseline").map(str::to_string),
                        stop_on_error: args.iter().any(|arg| arg == "--stop-on-error"),
                        ..Default::default()
                    },
                )
                .await?;
            if let Some(directory) = flag_value(&args, "--report-dir") {
                write_reports(&run, Path::new(directory))?;
                eprintln!("Reports written to {directory}");
            }
            println!("{}", json_report(&run)?);
            if run
                .executions
                .iter()
                .any(|item| item.state == ExecutionState::TransportFailed)
            {
                std::process::exit(4);
            }
            if run
                .executions
                .iter()
                .any(|item| item.state == ExecutionState::AssertionFailed)
            {
                std::process::exit(3);
            }
            if run
                .executions
                .iter()
                .any(|item| item.state == ExecutionState::Changed)
            {
                std::process::exit(2);
            }
        }
        Some("collections") => println!(
            "{}",
            serde_json::to_string_pretty(&engine.store.collections()?)?
        ),
        Some("environments") => println!(
            "{}",
            serde_json::to_string_pretty(&engine.store.environments()?)?
        ),
        Some("history") => println!(
            "{}",
            serde_json::to_string_pretty(&engine.store.runs(args.get(1).map(String::as_str))?)?
        ),
        Some("retention-clean") => {
            let policy = engine.store.retention_policy()?;
            println!(
                "{}",
                serde_json::to_string_pretty(&engine.store.cleanup_history(&policy)?)?
            );
        }
        Some("export-project") => {
            let collection_id = args.get(1).context("missing collection ID")?;
            let output = args.get(2).context("missing output .apiqa path")?;
            let collection = engine
                .store
                .collection(collection_id)?
                .context("collection not found")?;
            let source = export_project(&collection, &engine.store.environments()?)?;
            fs::write(output, source).with_context(|| format!("write {output}"))?;
            println!(
                "Exported {} to {} (secret environment values omitted)",
                collection.name, output
            );
        }
        Some("import-project") => {
            let path = args.get(1).context("missing .apiqa project path")?;
            let source = fs::read_to_string(path).with_context(|| format!("read {path}"))?;
            let bundle = import_project(&source)?;
            engine.store.save_collection(&bundle.collection)?;
            for environment in &bundle.environments {
                engine.store.save_environment(environment)?;
            }
            println!(
                "Imported {} ({} environments)",
                bundle.collection.name,
                bundle.environments.len()
            );
        }
        Some("diagnostics") => {
            println!("APIQA {}", env!("CARGO_PKG_VERSION"));
            println!("platform: {}-{}", env::consts::OS, env::consts::ARCH);
            println!("data directory: {}", data_dir.display());
            println!("collections: {}", engine.store.collections()?.len());
            println!("environments: {}", engine.store.environments()?.len());
            println!("runs: {}", engine.store.runs(None)?.len());
            println!("database integrity: ok");
        }
        _ => bail!(
            "usage: apiqa import <postman.json> | import-environment <environment.json> | run <collection-id> [--environment ID] [--baseline RUN_ID] [--report-dir DIR] [--stop-on-error] | collections | environments | history [collection-id] | retention-clean | export-project <collection-id> <project.apiqa> | import-project <project.apiqa> | diagnostics"
        ),
    }
    Ok(())
}

fn flag_value<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.iter()
        .position(|arg| arg == name)
        .and_then(|index| args.get(index + 1))
        .map(String::as_str)
}

fn write_reports(run: &apiqa_core::Run, directory: &Path) -> Result<()> {
    fs::create_dir_all(directory)?;
    fs::write(directory.join("apiqa-report.json"), json_report(run)?)?;
    fs::write(directory.join("apiqa-report.html"), html_report(run))?;
    fs::write(directory.join("apiqa-report.junit.xml"), junit_report(run))?;
    Ok(())
}
