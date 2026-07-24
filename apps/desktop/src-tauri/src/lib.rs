use androidqa_core::{
    AndroidApp, AndroidDevice, ProcessAdb, android,
    android::{AndroidCertificateInstall, QrPairingChallenge, QrPairingResult, QrPairingSecret},
    events::InspectorEvent,
    launch_app, list_devices, list_third_party_apps,
    persistence::Database,
    proxy::{CertificateInfo, ProxyConfiguration, ProxyService, ProxyStatus, generate_ca},
    traffic::HttpTransaction,
};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{Emitter, Manager};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
};
use uuid::Uuid;

struct InspectorState {
    proxy: Arc<ProxyService>,
    database: Arc<Database>,
    session_id: Mutex<Option<Uuid>>,
    ca_directory: std::path::PathBuf,
    qr_pairings: Mutex<HashMap<Uuid, QrPairingSecret>>,
    logcat_task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
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
fn begin_qr_pairing(state: tauri::State<'_, InspectorState>) -> Result<QrPairingChallenge, String> {
    let (challenge, secret) = android::create_qr_pairing().map_err(|error| error.to_string())?;
    state
        .qr_pairings
        .lock()
        .map_err(|_| "QR pairing lock poisoned")?
        .insert(challenge.id, secret);
    Ok(challenge)
}

#[tauri::command]
async fn finish_qr_pairing(
    state: tauri::State<'_, InspectorState>,
    pairing_id: Uuid,
) -> Result<QrPairingResult, String> {
    let secret = state
        .qr_pairings
        .lock()
        .map_err(|_| "QR pairing lock poisoned")?
        .remove(&pairing_id)
        .ok_or_else(|| "QR pairing request was not found or already used".to_owned())?;
    tauri::async_runtime::spawn_blocking(move || {
        let adb = ProcessAdb::discover().map_err(|error| error.to_string())?;
        loop {
            match android::finish_qr_pairing(&adb, &secret).map_err(|error| error.to_string())? {
                Some(result) => return Ok(result),
                None => std::thread::sleep(Duration::from_millis(500)),
            }
        }
    })
    .await
    .map_err(|error| format!("QR pairing task failed: {error}"))?
}

#[tauri::command]
async fn pair_with_code(
    host: String,
    port: u16,
    pairing_code: String,
) -> Result<QrPairingResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let adb = ProcessAdb::discover().map_err(|error| error.to_string())?;
        android::pair_with_code(&adb, &host, port, &pairing_code).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("pairing-code task failed: {error}"))?
}

#[tauri::command]
async fn enable_usb_wifi(serial: String, port: Option<u16>) -> Result<QrPairingResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let adb = ProcessAdb::discover().map_err(|error| error.to_string())?;
        android::enable_usb_wifi(&adb, &serial, port.unwrap_or(5555))
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("USB Wi-Fi task failed: {error}"))?
}

#[tauri::command]
async fn prepare_android_certificate_install(
    state: tauri::State<'_, InspectorState>,
    serial: String,
) -> Result<AndroidCertificateInstall, String> {
    let certificate_path = state.proxy.configuration().ca_certificate_path.clone();
    if !certificate_path.exists() {
        generate_ca(&state.ca_directory).map_err(|error| error.to_string())?;
    }
    tauri::async_runtime::spawn_blocking(move || {
        let adb = ProcessAdb::discover().map_err(|error| error.to_string())?;
        android::prepare_certificate_install(&adb, &serial, &certificate_path)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("certificate setup task failed: {error}"))?
}

#[tauri::command]
fn get_proxy_status(state: tauri::State<'_, InspectorState>) -> ProxyStatus {
    state.proxy.status()
}
#[tauri::command]
fn get_proxy_configuration(state: tauri::State<'_, InspectorState>) -> ProxyConfiguration {
    state.proxy.configuration().clone()
}
#[tauri::command]
fn generate_ca_certificate(
    state: tauri::State<'_, InspectorState>,
) -> Result<CertificateInfo, String> {
    generate_ca(&state.ca_directory).map_err(|error| error.to_string())
}
#[tauri::command]
async fn start_proxy(state: tauri::State<'_, InspectorState>) -> Result<String, String> {
    let session_id = state
        .session_id
        .lock()
        .map_err(|_| "session lock poisoned")?
        .unwrap_or_else(Uuid::new_v4);
    *state
        .session_id
        .lock()
        .map_err(|_| "session lock poisoned")? = Some(session_id);
    state
        .proxy
        .start(session_id)
        .await
        .map_err(|error| error.to_string())?;
    Ok(session_id.to_string())
}

#[tauri::command]
async fn start_logcat_capture(
    state: tauri::State<'_, InspectorState>,
    serial: String,
    package_name: String,
) -> Result<(), String> {
    if package_name.trim().is_empty() {
        return Ok(());
    }
    let session_id = (*state
        .session_id
        .lock()
        .map_err(|_| "session lock poisoned")?)
    .ok_or_else(|| "start the proxy before starting log capture".to_owned())?;
    let adb = ProcessAdb::discover().map_err(|error| error.to_string())?;
    let uid = android::app_uid(&adb, &serial, &package_name).map_err(|error| error.to_string())?;
    let mut previous = state
        .logcat_task
        .lock()
        .map_err(|_| "logcat lock poisoned")?;
    if let Some(task) = previous.take() {
        task.abort();
    }
    let adb_path = adb.path().to_path_buf();
    let events = state.proxy.events();
    let task = tauri::async_runtime::spawn(async move {
        let mut child = match Command::new(adb_path)
            .args([
                "-s",
                &serial,
                "logcat",
                &format!("--uid={uid}"),
                "-v",
                "epoch",
            ])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
        {
            Ok(child) => child,
            Err(_) => return,
        };
        let Some(stdout) = child.stdout.take() else {
            return;
        };
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let Some(log_line) = androidqa_core::diagnostics::parse_logcat_epoch_line(&line) else {
                continue;
            };
            if let Some(incident) = androidqa_core::diagnostics::parse_incident(
                session_id,
                &package_name,
                vec![log_line],
            ) {
                events.send(InspectorEvent::IncidentCreated(incident));
            }
        }
    });
    *previous = Some(task);
    Ok(())
}
#[tauri::command]
async fn stop_proxy(state: tauri::State<'_, InspectorState>) -> Result<(), String> {
    if let Some(task) = state
        .logcat_task
        .lock()
        .map_err(|_| "logcat lock poisoned")?
        .take()
    {
        task.abort();
    }
    state.proxy.stop().await;
    Ok(())
}
#[tauri::command]
async fn restart_proxy(state: tauri::State<'_, InspectorState>) -> Result<String, String> {
    state.proxy.stop().await;
    start_proxy(state).await
}
#[tauri::command]
async fn configure_android_proxy(serial: String, host: String, port: u16) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let adb = ProcessAdb::discover().map_err(|e| e.to_string())?;
        android::configure_proxy(&adb, &serial, &host, port).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn clear_android_proxy(serial: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let adb = ProcessAdb::discover().map_err(|e| e.to_string())?;
        android::clear_proxy(&adb, &serial).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn verify_android_proxy(serial: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let adb = ProcessAdb::discover().map_err(|e| e.to_string())?;
        android::verify_proxy(&adb, &serial).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn list_transactions(
    state: tauri::State<'_, InspectorState>,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<Vec<HttpTransaction>, String> {
    let Some(session_id) = *state
        .session_id
        .lock()
        .map_err(|_| "session lock poisoned")?
    else {
        return Ok(vec![]);
    };
    state
        .database
        .list_transactions(session_id, limit.unwrap_or(250), offset.unwrap_or(0))
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn get_transaction(
    state: tauri::State<'_, InspectorState>,
    id: Uuid,
) -> Result<Option<HttpTransaction>, String> {
    state
        .database
        .get_transaction(id)
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn approve_baseline(
    state: tauri::State<'_, InspectorState>,
    endpoint_id: String,
    transaction_id: Uuid,
) -> Result<(), String> {
    state
        .database
        .approve_baseline(&endpoint_id, transaction_id)
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let database = Arc::new(Database::open(data_dir.join("inspector.sqlite"))?);
            let events = androidqa_core::events::EventBroadcaster::default();
            let ca_directory = data_dir.join("certificate-authority");
            let proxy = Arc::new(ProxyService::new(
                ProxyConfiguration {
                    bind_address: "0.0.0.0".into(),
                    port: 8080,
                    ca_certificate_path: ca_directory.join("app-tester-ca.pem"),
                    ca_fingerprint_sha256: None,
                },
                database.clone(),
                events.clone(),
            ));
            let mut receiver = events.subscribe();
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                while let Ok(event) = receiver.recv().await {
                    let name = match &event {
                        InspectorEvent::ProxyStatusChanged(_) => "proxy-status-changed",
                        InspectorEvent::SessionStatusChanged(_) => "session-status-changed",
                        InspectorEvent::TransactionCreated(_) => "transaction-created",
                        InspectorEvent::TransactionUpdated(_) => "transaction-updated",
                        InspectorEvent::TransactionCompleted(_) => "transaction-completed",
                        InspectorEvent::ComparisonCompleted { .. } => "comparison-completed",
                        InspectorEvent::IncidentCreated(_) => "incident-created",
                        InspectorEvent::IssueCreated(_) => "issue-created",
                        InspectorEvent::DeviceStatusChanged(_) => "device-status-changed",
                    };
                    let _ = handle.emit(name, event);
                }
            });
            app.manage(InspectorState {
                proxy,
                database,
                session_id: Mutex::new(None),
                ca_directory,
                qr_pairings: Mutex::new(HashMap::new()),
                logcat_task: Mutex::new(None),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            discover_devices,
            list_installed_apps,
            launch_installed_app,
            begin_qr_pairing,
            finish_qr_pairing,
            pair_with_code,
            enable_usb_wifi,
            prepare_android_certificate_install,
            start_proxy,
            start_logcat_capture,
            stop_proxy,
            restart_proxy,
            get_proxy_status,
            get_proxy_configuration,
            generate_ca_certificate,
            configure_android_proxy,
            clear_android_proxy,
            verify_android_proxy,
            list_transactions,
            get_transaction,
            approve_baseline
        ])
        .run(tauri::generate_context!())
        .expect("failed to start App Tester");
}
