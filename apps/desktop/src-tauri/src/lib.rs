use androidqa_core::{
    AndroidApp, AndroidDevice, ProcessAdb, launch_app, list_devices, list_third_party_apps,
};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use tauri::{Emitter, Manager};

#[derive(Debug, Serialize, Deserialize)]
struct ScanSummary {
    states_discovered: usize,
    actions_executed: usize,
    frontier_remaining: usize,
    complete: bool,
    issues: usize,
    #[serde(default)]
    equivalent_actions_skipped: usize,
    #[serde(default)]
    skipped_branches: usize,
}

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

#[tauri::command]
async fn run_autonomous_scan(
    app: tauri::AppHandle,
    serial: String,
    package_name: String,
) -> Result<ScanSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let adb = ProcessAdb::discover().map_err(|error| error.to_string())?;
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?;
        let output = data_dir.join("scans").join(format!(
            "{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|error| error.to_string())?
                .as_secs()
        ));
        std::fs::create_dir_all(&output).map_err(|error| error.to_string())?;
        let bundled = app
            .path()
            .resource_dir()
            .map_err(|error| error.to_string())?
            .join("scripts/autonomous_scan.py");
        let development = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../scripts/autonomous_scan.py");
        let script = if bundled.is_file() {
            bundled
        } else {
            development
        };
        let python = if cfg!(windows) { "python" } else { "python3" };
        let mut child = Command::new(python)
            .arg(&script)
            .args(["--serial", &serial, "--package", &package_name])
            .args([
                "--max-states",
                "0",
                "--max-actions",
                "0",
                "--max-minutes",
                "120",
            ])
            .arg("--adb")
            .arg(adb.path())
            .arg("--output")
            .arg(&output)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("failed to start local scanner: {error}"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "local scanner stdout was unavailable".to_owned())?;
        for line in BufReader::new(stdout).lines() {
            let line = line.map_err(|error| error.to_string())?;
            app.emit("scan-progress", &line)
                .map_err(|error| error.to_string())?;
        }
        let result = child
            .wait_with_output()
            .map_err(|error| error.to_string())?;
        if !result.status.success() {
            return Err(format!(
                "local scanner failed: {}",
                String::from_utf8_lossy(&result.stderr).trim()
            ));
        }
        let summary_path = output.join("summary.json");
        let summary: ScanSummary = serde_json::from_slice(
            &std::fs::read(&summary_path).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        app.emit("scan-completed", output.display().to_string())
            .map_err(|error| error.to_string())?;
        Ok(summary)
    })
    .await
    .map_err(|error| format!("scan task failed: {error}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            discover_devices,
            list_installed_apps,
            launch_installed_app,
            run_autonomous_scan
        ])
        .run(tauri::generate_context!())
        .expect("failed to start App Tester");
}
