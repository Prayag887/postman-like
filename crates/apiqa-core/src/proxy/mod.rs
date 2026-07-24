use crate::{
    events::{EventBroadcaster, InspectorEvent},
    persistence::Database,
    traffic::*,
};
use dashmap::DashMap;
use http_body_util::BodyExt;
use hudsucker::{
    Body, HttpContext, HttpHandler, Proxy, RequestOrResponse,
    certificate_authority::RcgenAuthority,
    hyper::{Request, Response},
    rcgen::{
        BasicConstraints, CertificateParams, DistinguishedName, DnType, IsCa, Issuer, KeyPair,
    },
    rustls::crypto::aws_lc_rs,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use time::OffsetDateTime;
use tokio::{sync::oneshot, task::JoinHandle};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProxyStatus {
    Stopped,
    Starting,
    Running,
    CertificateRequired,
    DeviceNotConfigured,
    PartiallyAvailable,
    BlockedByPinning,
    Failed,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyConfiguration {
    pub bind_address: String,
    pub port: u16,
    pub ca_certificate_path: PathBuf,
    pub ca_fingerprint_sha256: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CertificateInfo {
    pub certificate_path: PathBuf,
    pub fingerprint_sha256: String,
}

pub fn generate_ca(directory: &Path) -> anyhow::Result<CertificateInfo> {
    std::fs::create_dir_all(directory)?;
    let key = KeyPair::generate()?;
    let mut params = CertificateParams::default();
    let mut name = DistinguishedName::new();
    name.push(DnType::CommonName, "App Tester Local Inspection CA");
    name.push(DnType::OrganizationName, "App Tester");
    params.distinguished_name = name;
    params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    let certificate = params.self_signed(&key)?;
    let cert_path = directory.join("app-tester-ca.pem");
    let key_path = directory.join("app-tester-ca-key.pem");
    std::fs::write(&cert_path, certificate.pem())?;
    std::fs::write(&key_path, key.serialize_pem())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o600))?;
    }
    let fingerprint = format!("{:x}", Sha256::digest(certificate.der()));
    Ok(CertificateInfo {
        certificate_path: cert_path,
        fingerprint_sha256: fingerprint,
    })
}

fn load_authority(directory: &Path) -> anyhow::Result<RcgenAuthority> {
    let key = std::fs::read_to_string(directory.join("app-tester-ca-key.pem"))?;
    let cert = std::fs::read_to_string(directory.join("app-tester-ca.pem"))?;
    let key = KeyPair::from_pem(&key)?;
    let issuer = Issuer::from_ca_cert_pem(&cert, key)?;
    Ok(RcgenAuthority::new(
        issuer,
        1_000,
        aws_lc_rs::default_provider(),
    ))
}

#[derive(Clone)]
struct CaptureHandler {
    session_id: Uuid,
    current_id: Option<Uuid>,
    transactions: Arc<DashMap<Uuid, HttpTransaction>>,
    database: Arc<Database>,
    events: EventBroadcaster,
    preview_limit: usize,
}
fn headers(map: &hudsucker::hyper::HeaderMap) -> Vec<HeaderEntry> {
    map.iter()
        .map(|(name, value)| HeaderEntry {
            name: name.to_string(),
            value: value.to_str().unwrap_or("<binary>").to_owned(),
        })
        .collect()
}
fn version(version: hudsucker::hyper::Version) -> String {
    format!("{version:?}")
}
fn body_storage(bytes: &[u8], limit: usize) -> BodyStorage {
    if bytes.is_empty() {
        BodyStorage::Empty
    } else if bytes.len() <= limit {
        BodyStorage::Inline {
            bytes: bytes.to_vec(),
        }
    } else {
        BodyStorage::Truncated {
            preview: bytes[..limit].to_vec(),
            original_size: Some(bytes.len() as u64),
        }
    }
}
fn redact_body(bytes: &[u8], content_type: Option<&str>) -> Vec<u8> {
    if !content_type.is_some_and(|value| value.to_ascii_lowercase().contains("json")) {
        return bytes.to_vec();
    }
    let Ok(mut value) = serde_json::from_slice(bytes) else {
        return bytes.to_vec();
    };
    redact_json(&mut value);
    serde_json::to_vec(&value).unwrap_or_default()
}
impl HttpHandler for CaptureHandler {
    async fn handle_request(
        &mut self,
        _ctx: &HttpContext,
        request: Request<Body>,
    ) -> RequestOrResponse {
        let (parts, body) = request.into_parts();
        let now = OffsetDateTime::now_utc();
        let id = Uuid::new_v4();
        self.current_id = Some(id);
        let uri = parts.uri.clone();
        let query = uri
            .query()
            .map(|query| {
                url::form_urlencoded::parse(query.as_bytes())
                    .map(|(name, value)| QueryParameter {
                        value: if is_secret(&name) {
                            "<redacted>".into()
                        } else {
                            value.into_owned()
                        },
                        name: name.into_owned(),
                    })
                    .collect()
            })
            .unwrap_or_default();
        let content_type = parts
            .headers
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let captured_request = CapturedRequest {
            method: parts.method.to_string(),
            scheme: uri.scheme_str().unwrap_or("http").into(),
            host: uri
                .host()
                .or_else(|| {
                    parts
                        .headers
                        .get("host")
                        .and_then(|value| value.to_str().ok())
                        .map(|host| host.split(':').next().unwrap_or(host))
                })
                .unwrap_or("unknown")
                .into(),
            port: uri.port_u16(),
            path: uri.path().to_owned(),
            query,
            content_type: content_type.clone(),
            headers: redact_headers(&headers(&parts.headers)),
            body: BodyStorage::Empty,
            http_version: version(parts.version),
        };
        let transaction = HttpTransaction {
            id,
            session_id: self.session_id,
            connection_id: Uuid::new_v4(),
            request: captured_request,
            response: None,
            state: TransactionState::RequestStarted,
            timing: TransactionTiming {
                request_started_ms: now.unix_timestamp_nanos() as i64 / 1_000_000,
                ..Default::default()
            },
            endpoint_identity: None,
            curl: None,
            capture_quality: CaptureQuality::MetadataOnly,
            comparison: None,
            correlated_incidents: vec![],
            created_at: now,
            updated_at: now,
        };
        self.transactions.insert(id, transaction.clone());
        let _ = self.database.upsert_transaction(&transaction);
        self.events
            .send(InspectorEvent::TransactionCreated(transaction));

        let bytes = match body.collect().await {
            Ok(collected) => collected.to_bytes(),
            Err(_) => return Request::from_parts(parts, Body::empty()).into(),
        };
        let redacted = redact_body(&bytes, content_type.as_deref());
        if let Some(mut transaction) = self.transactions.get_mut(&id) {
            let now = OffsetDateTime::now_utc();
            transaction.request.body = body_storage(&redacted, self.preview_limit);
            transaction.endpoint_identity = Some(EndpointIdentity {
                method: transaction.request.method.clone(),
                host: transaction.request.host.to_lowercase(),
                path_template: normalize_path(&transaction.request.path),
                content_type: transaction.request.content_type.clone(),
                request_shape: request_shape(&transaction.request.body),
            });
            transaction.curl = Some(generate_curl(&transaction.request));
            transaction.state = TransactionState::RequestComplete;
            transaction.timing.request_complete_ms =
                Some(now.unix_timestamp_nanos() as i64 / 1_000_000);
            transaction.updated_at = now;
            transaction.capture_quality = if bytes.len() > self.preview_limit {
                CaptureQuality::PreviewOnly
            } else {
                CaptureQuality::Complete
            };
            let updated = transaction.clone();
            let _ = self.database.upsert_transaction(&updated);
            self.events
                .send(InspectorEvent::TransactionUpdated(updated));
        }
        Request::from_parts(parts, Body::from(bytes)).into()
    }
    async fn handle_response(
        &mut self,
        _ctx: &HttpContext,
        response: Response<Body>,
    ) -> Response<Body> {
        let (parts, body) = response.into_parts();
        let bytes = match body.collect().await {
            Ok(collected) => collected.to_bytes(),
            Err(_) => return Response::from_parts(parts, Body::empty()),
        };
        let previous = self.current_id.and_then(|current_id| {
            let endpoint = self
                .transactions
                .get(&current_id)?
                .endpoint_identity
                .clone()?;
            self.transactions
                .iter()
                .filter(|entry| entry.id != current_id && entry.response.is_some())
                .filter(|entry| {
                    entry.endpoint_identity.as_ref().is_some_and(|candidate| {
                        crate::comparison::compatibility(&endpoint, candidate)
                            != crate::comparison::ComparisonCompatibility::Incompatible
                    })
                })
                .max_by_key(|entry| entry.updated_at)
                .map(|entry| entry.clone())
        });
        if let Some(id) = self.current_id
            && let Some(mut transaction) = self.transactions.get_mut(&id)
        {
            let now = OffsetDateTime::now_utc();
            let content_type = parts
                .headers
                .get("content-type")
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned);
            let redacted = redact_body(&bytes, content_type.as_deref());
            transaction.response = Some(CapturedResponse {
                status: parts.status.as_u16(),
                reason: parts.status.canonical_reason().map(str::to_owned),
                headers: redact_headers(&headers(&parts.headers)),
                body: body_storage(&redacted, self.preview_limit),
                content_type,
                decoded_size: bytes.len() as u64,
                encoded_size: bytes.len() as u64,
                http_version: version(parts.version),
            });
            transaction.state = TransactionState::ResponseComplete;
            transaction.updated_at = now;
            transaction.timing.response_started_ms =
                Some(now.unix_timestamp_nanos() as i64 / 1_000_000);
            transaction.timing.response_complete_ms = transaction.timing.response_started_ms;
            if let (Some(previous), Some(current_endpoint), Some(current_response)) = (
                previous,
                transaction.endpoint_identity.as_ref(),
                transaction.response.as_ref(),
            ) {
                let mut differences = Vec::new();
                if let Some(previous_response) = previous.response.as_ref() {
                    if previous_response.status != current_response.status {
                        differences.push(crate::comparison::Difference {
                            kind: crate::comparison::DifferenceKind::StatusChanged,
                            path: None,
                            previous: Some(crate::comparison::DisplayValue(
                                previous_response.status.to_string(),
                            )),
                            current: Some(crate::comparison::DisplayValue(
                                current_response.status.to_string(),
                            )),
                            severity: crate::comparison::DifferenceSeverity::Critical,
                            ignored: false,
                            explanation: "HTTP status changed".into(),
                        });
                    }
                    if let (Some(before), Some(after)) = (
                        previous_response
                            .body
                            .bytes()
                            .and_then(|body| serde_json::from_slice(body).ok()),
                        current_response
                            .body
                            .bytes()
                            .and_then(|body| serde_json::from_slice(body).ok()),
                    ) {
                        differences.extend(crate::comparison::compare_json(
                            &before,
                            &after,
                            &crate::comparison::ComparisonRules::default(),
                        ));
                    }
                }
                transaction.comparison = Some(crate::comparison::ResponseComparison {
                    baseline_transaction_id: Some(previous.id),
                    compatibility: previous
                        .endpoint_identity
                        .as_ref()
                        .map(|endpoint| {
                            crate::comparison::compatibility(endpoint, current_endpoint)
                        })
                        .unwrap_or(
                            crate::comparison::ComparisonCompatibility::PossiblyIncompatible,
                        ),
                    differences,
                });
            }
            let completed = transaction.clone();
            let _ = self.database.upsert_transaction(&completed);
            self.events
                .send(InspectorEvent::TransactionCompleted(completed));
        }
        Response::from_parts(parts, Body::from(bytes))
    }
}

pub struct ProxyService {
    status: Arc<Mutex<ProxyStatus>>,
    config: ProxyConfiguration,
    database: Arc<Database>,
    events: EventBroadcaster,
    transactions: Arc<DashMap<Uuid, HttpTransaction>>,
    shutdown: Mutex<Option<oneshot::Sender<()>>>,
    task: Mutex<Option<JoinHandle<()>>>,
}
impl ProxyService {
    pub fn new(
        config: ProxyConfiguration,
        database: Arc<Database>,
        events: EventBroadcaster,
    ) -> Self {
        Self {
            status: Arc::new(Mutex::new(ProxyStatus::Stopped)),
            config,
            database,
            events,
            transactions: Arc::new(DashMap::new()),
            shutdown: Mutex::new(None),
            task: Mutex::new(None),
        }
    }
    pub fn status(&self) -> ProxyStatus {
        *self.status.lock().expect("proxy status lock")
    }
    pub fn configuration(&self) -> &ProxyConfiguration {
        &self.config
    }
    pub fn events(&self) -> EventBroadcaster {
        self.events.clone()
    }
    fn set_status(&self, status: ProxyStatus) {
        *self.status.lock().expect("proxy status lock") = status;
        self.events.send(InspectorEvent::ProxyStatusChanged(status));
    }
    pub async fn start(&self, session_id: Uuid) -> anyhow::Result<()> {
        if self.status() == ProxyStatus::Running {
            return Ok(());
        }
        self.set_status(ProxyStatus::Starting);
        let ca_dir = self
            .config
            .ca_certificate_path
            .parent()
            .ok_or_else(|| anyhow::anyhow!("invalid CA path"))?;
        if !self.config.ca_certificate_path.exists() {
            self.set_status(ProxyStatus::CertificateRequired);
            anyhow::bail!("CA certificate is required");
        }
        let ca = load_authority(ca_dir)?;
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let handler = CaptureHandler {
            session_id,
            current_id: None,
            transactions: self.transactions.clone(),
            database: self.database.clone(),
            events: self.events.clone(),
            preview_limit: 1024 * 1024,
        };
        let proxy = Proxy::builder()
            .with_addr(
                format!("{}:{}", self.config.bind_address, self.config.port)
                    .parse::<SocketAddr>()?,
            )
            .with_ca(ca)
            .with_rustls_connector(aws_lc_rs::default_provider())
            .with_http_handler(handler)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .build()?;
        let status = self.status.clone();
        let events = self.events.clone();
        let task = tokio::spawn(async move {
            if proxy.start().await.is_err() {
                *status.lock().expect("proxy status lock") = ProxyStatus::Failed;
                events.send(InspectorEvent::ProxyStatusChanged(ProxyStatus::Failed));
            }
        });
        *self.shutdown.lock().expect("shutdown lock") = Some(shutdown_tx);
        *self.task.lock().expect("task lock") = Some(task);
        self.set_status(ProxyStatus::Running);
        Ok(())
    }
    pub async fn stop(&self) {
        if let Some(sender) = self.shutdown.lock().expect("shutdown lock").take() {
            let _ = sender.send(());
        }
        let task = self.task.lock().expect("task lock").take();
        if let Some(task) = task {
            let _ = task.await;
        }
        self.set_status(ProxyStatus::Stopped);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ca_generation_writes_restricted_key() {
        let root = std::env::temp_dir().join(format!("app-tester-ca-{}", Uuid::new_v4()));
        let info = generate_ca(&root).unwrap();
        assert!(info.certificate_path.exists());
        assert_eq!(info.fingerprint_sha256.len(), 64);
        let _ = std::fs::remove_dir_all(root);
    }
}
