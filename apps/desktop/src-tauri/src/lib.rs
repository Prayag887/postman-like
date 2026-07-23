use androidqa_core::{
    AndroidApp, AndroidDevice, ProcessAdb, launch_app, list_devices, list_third_party_apps,
};

#[tauri::command]
async fn discover_devices() -> Result<Vec<AndroidDevice>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let adb = ProcessAdb::discover().map_err(|error| error.to_string())?;
        list_devices(&adb).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("device discovery task failed: {error}"))?
}

#[tauri::command]
async fn list_installed_apps(serial: String) -> Result<Vec<AndroidApp>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let adb = ProcessAdb::discover().map_err(|error| error.to_string())?;
        list_third_party_apps(&adb, &serial).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("application discovery task failed: {error}"))?
}

#[tauri::command]
async fn launch_installed_app(serial: String, package_name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let adb = ProcessAdb::discover().map_err(|error| error.to_string())?;
        launch_app(&adb, &serial, &package_name).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("application launch task failed: {error}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            discover_devices,
            list_installed_apps,
            launch_installed_app
        ])
        .run(tauri::generate_context!())
        .expect("failed to start App Tester");
}
