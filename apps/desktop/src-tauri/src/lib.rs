use std::sync::Arc;

use apiqa_core::{ApiQaEngine, Collection, Run, RunOptions, Store, import_postman};
use tauri::{Manager, State};

struct AppState(Arc<ApiQaEngine>);

#[tauri::command]
fn list_collections(state: State<'_, AppState>) -> Result<Vec<Collection>, String> {
    state.0.store.collections().map_err(display_error)
}

#[tauri::command]
fn import_collection(source: String, state: State<'_, AppState>) -> Result<Collection, String> {
    let collection = import_postman(&source).map_err(display_error)?;
    state
        .0
        .store
        .save_collection(&collection)
        .map_err(display_error)?;
    Ok(collection)
}

#[tauri::command]
async fn run_collection(
    collection_id: String,
    baseline_run_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Run, String> {
    let collection = state
        .0
        .store
        .collection(&collection_id)
        .map_err(display_error)?
        .ok_or_else(|| "Collection not found".to_string())?;
    state
        .0
        .run_collection(
            &collection,
            RunOptions {
                baseline_run_id,
                ..Default::default()
            },
        )
        .await
        .map_err(display_error)
}

#[tauri::command]
fn list_runs(
    collection_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<Run>, String> {
    state
        .0
        .store
        .runs(collection_id.as_deref())
        .map_err(display_error)
}

fn display_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let store = Store::open(data_dir.join("apiqa.db"))?;
            app.manage(AppState(Arc::new(ApiQaEngine::new(store))));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_collections,
            import_collection,
            run_collection,
            list_runs
        ])
        .run(tauri::generate_context!())
        .expect("error while running APIQA");
}
