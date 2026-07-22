use std::sync::Arc;

use apiqa_core::{
    ApiQaEngine, CleanupResult, Collection, Environment, RetentionPolicy, Run, RunOptions, Store,
    export_workspace, import_postman, import_postman_environment, import_workspace,
};
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
fn save_collection(collection: Collection, state: State<'_, AppState>) -> Result<(), String> {
    state
        .0
        .store
        .save_collection(&collection)
        .map_err(display_error)
}

#[tauri::command]
fn import_environment(source: String, state: State<'_, AppState>) -> Result<Environment, String> {
    let environment = import_postman_environment(&source).map_err(display_error)?;
    state
        .0
        .store
        .save_environment(&environment)
        .map_err(display_error)?;
    Ok(environment)
}

#[tauri::command]
fn list_environments(state: State<'_, AppState>) -> Result<Vec<Environment>, String> {
    state.0.store.environments().map_err(display_error)
}

#[tauri::command]
fn save_environment(environment: Environment, state: State<'_, AppState>) -> Result<(), String> {
    state
        .0
        .store
        .save_environment(&environment)
        .map_err(display_error)
}

#[tauri::command]
fn export_workspace_bundle(state: State<'_, AppState>) -> Result<String, String> {
    let collections = state.0.store.collections().map_err(display_error)?;
    let environments = state.0.store.environments().map_err(display_error)?;
    export_workspace(&collections, &environments).map_err(display_error)
}

#[tauri::command]
fn export_workspace_file(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let source = export_workspace_bundle(state)?;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(display_error)?
        .as_secs();
    let path = app
        .path()
        .download_dir()
        .map_err(display_error)?
        .join(format!("apiqa-workspace-{timestamp}.apiqa-workspace"));
    std::fs::write(&path, source).map_err(display_error)?;
    Ok(path.display().to_string())
}

#[tauri::command]
fn import_workspace_bundle(
    source: String,
    state: State<'_, AppState>,
) -> Result<Vec<Collection>, String> {
    let bundle = import_workspace(&source).map_err(display_error)?;
    for collection in &bundle.collections {
        state
            .0
            .store
            .save_collection(collection)
            .map_err(display_error)?;
    }
    for environment in &bundle.environments {
        state
            .0
            .store
            .save_environment(environment)
            .map_err(display_error)?;
    }
    Ok(bundle.collections)
}

#[tauri::command]
async fn run_collection(
    collection_id: String,
    baseline_run_id: Option<String>,
    environment_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Run, String> {
    let collection = state
        .0
        .store
        .collection(&collection_id)
        .map_err(display_error)?
        .ok_or_else(|| "Collection not found".to_string())?;
    let environment = match environment_id {
        Some(id) => state
            .0
            .store
            .environments()
            .map_err(display_error)?
            .into_iter()
            .find(|environment| environment.id == id),
        None => None,
    };
    state
        .0
        .run_collection(
            &collection,
            RunOptions {
                baseline_run_id,
                environment,
                ..Default::default()
            },
        )
        .await
        .map_err(display_error)
}

#[tauri::command]
async fn run_request(
    collection_id: String,
    request_id: String,
    baseline_run_id: Option<String>,
    environment_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Run, String> {
    let mut collection = state
        .0
        .store
        .collection(&collection_id)
        .map_err(display_error)?
        .ok_or_else(|| "Collection not found".to_string())?;
    collection
        .requests
        .retain(|request| request.id == request_id);
    if collection.requests.is_empty() {
        return Err("Request not found".into());
    }
    let environment = match environment_id {
        Some(id) => state
            .0
            .store
            .environments()
            .map_err(display_error)?
            .into_iter()
            .find(|environment| environment.id == id),
        None => None,
    };
    state
        .0
        .run_collection(
            &collection,
            RunOptions {
                baseline_run_id,
                environment,
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

#[tauri::command]
fn set_run_pinned(id: String, pinned: bool, state: State<'_, AppState>) -> Result<(), String> {
    state
        .0
        .store
        .set_run_pinned(&id, pinned)
        .map_err(display_error)
}

#[tauri::command]
fn retention_policy(state: State<'_, AppState>) -> Result<RetentionPolicy, String> {
    state.0.store.retention_policy().map_err(display_error)
}

#[tauri::command]
fn save_retention_policy(
    policy: RetentionPolicy,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .0
        .store
        .set_retention_policy(&policy)
        .map_err(display_error)
}

#[tauri::command]
fn cleanup_history(state: State<'_, AppState>) -> Result<CleanupResult, String> {
    let policy = state.0.store.retention_policy().map_err(display_error)?;
    state
        .0
        .store
        .cleanup_history(&policy)
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
            let policy = store.retention_policy()?;
            store.cleanup_history(&policy)?;
            app.manage(AppState(Arc::new(ApiQaEngine::new(store))));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_collections,
            import_collection,
            save_collection,
            import_environment,
            list_environments,
            save_environment,
            export_workspace_bundle,
            export_workspace_file,
            import_workspace_bundle,
            run_collection,
            run_request,
            list_runs,
            set_run_pinned,
            retention_policy,
            save_retention_policy,
            cleanup_history
        ])
        .run(tauri::generate_context!())
        .expect("error while running APIQA");
}
