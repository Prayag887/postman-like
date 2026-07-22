use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};

use anyhow::{Context, Result, bail};
use chrono::Utc;
use reqwest::{Client, Method};
use uuid::Uuid;

use crate::{
    ApiKeyLocation, ApiRequest, AssertionResult, Auth, BodyKind, Collection, ComparisonOptions,
    ExecutionState, ExtractedValue, ExtractionRule, KeyValue, RequestExecution, ResponseAssertion,
    ResponseSnapshot, Run, RunOptions, RunState, Store, compare_responses,
};

pub struct ApiQaEngine {
    pub store: Arc<Store>,
}

impl ApiQaEngine {
    pub fn new(store: Store) -> Self {
        Self {
            store: Arc::new(store),
        }
    }

    pub async fn run_collection(
        &self,
        collection: &Collection,
        options: RunOptions,
    ) -> Result<Run> {
        let baseline = match options.baseline_run_id.as_deref() {
            Some(id) => self.store.run(id)?,
            None => self.store.runs(Some(&collection.id))?.into_iter().next(),
        };
        let mut run = Run {
            id: Uuid::new_v4().to_string(),
            collection_id: collection.id.clone(),
            collection_name: collection.name.clone(),
            environment_name: options
                .environment
                .as_ref()
                .map(|environment| environment.name.clone()),
            started_at: Utc::now(),
            completed_at: None,
            state: RunState::Running,
            baseline_run_id: baseline.as_ref().map(|run| run.id.clone()),
            executions: Vec::new(),
            pinned: false,
        };
        self.store.save_run(&run)?;

        let mut client_builder = Client::builder()
            .timeout(Duration::from_millis(options.timeout_ms))
            .danger_accept_invalid_certs(options.accept_invalid_certificates);
        if let Some(proxy_url) = options.proxy_url.as_deref() {
            client_builder = client_builder.proxy(reqwest::Proxy::all(proxy_url)?);
        }
        let client = client_builder.build()?;
        let mut variables = resolve_variables(collection, options.environment.as_ref());
        for request in collection
            .requests
            .iter()
            .filter(|request| !request.disabled)
        {
            let previous = baseline.as_ref().and_then(|run| {
                run.executions
                    .iter()
                    .find(|execution| execution.request_id == request.id)
            });
            let execution = execute(&client, &run.id, request, &variables, previous).await;
            for extracted in &execution.extractions {
                variables.insert(extracted.name.clone(), extracted.value.clone());
            }
            let failed = matches!(
                execution.state,
                ExecutionState::TransportFailed | ExecutionState::AssertionFailed
            );
            run.executions.push(execution);
            self.store.save_run(&run)?;
            if failed && options.stop_on_error {
                break;
            }
        }

        run.completed_at = Some(Utc::now());
        run.state = if run.executions.iter().any(|execution| {
            matches!(
                execution.state,
                ExecutionState::TransportFailed | ExecutionState::AssertionFailed
            )
        }) {
            RunState::Failed
        } else if run
            .executions
            .iter()
            .any(|execution| execution.state == ExecutionState::Changed)
        {
            RunState::CompletedWithFindings
        } else {
            RunState::Completed
        };
        self.store.save_run(&run)?;
        let policy = self.store.retention_policy()?;
        self.store.cleanup_history(&policy)?;
        Ok(run)
    }
}

async fn execute(
    client: &Client,
    run_id: &str,
    request: &ApiRequest,
    variables: &HashMap<String, String>,
    baseline: Option<&RequestExecution>,
) -> RequestExecution {
    let started_at = Utc::now();
    let started = Instant::now();
    let result = send(client, request, variables).await;
    match result {
        Ok(mut response) => {
            response.duration_ms = started.elapsed().as_millis() as u64;
            let assertions = evaluate_assertions(request, &response);
            let extractions = extract_values(request, &response);
            let assertion_failed = assertions.iter().any(|result| !result.passed);
            let comparison = baseline
                .and_then(|execution| execution.response.as_ref())
                .map(|previous| {
                    compare_responses(previous, &response, &ComparisonOptions::default())
                });
            let changed = comparison
                .as_ref()
                .is_some_and(|comparison| comparison.changed);
            RequestExecution {
                id: Uuid::new_v4().to_string(),
                run_id: run_id.to_string(),
                request_id: request.id.clone(),
                request_name: request.name.clone(),
                state: if assertion_failed {
                    ExecutionState::AssertionFailed
                } else if changed {
                    ExecutionState::Changed
                } else {
                    ExecutionState::Passed
                },
                started_at,
                response: Some(response),
                error: None,
                comparison,
                assertions,
                extractions,
            }
        }
        Err(error) => RequestExecution {
            id: Uuid::new_v4().to_string(),
            run_id: run_id.to_string(),
            request_id: request.id.clone(),
            request_name: request.name.clone(),
            state: ExecutionState::TransportFailed,
            started_at,
            response: None,
            error: Some(format!("{error:#}")),
            comparison: None,
            assertions: vec![],
            extractions: vec![],
        },
    }
}

async fn send(
    client: &Client,
    request: &ApiRequest,
    variables: &HashMap<String, String>,
) -> Result<ResponseSnapshot> {
    let url = substitute(&request.url, variables);
    if !url.starts_with("http://") && !url.starts_with("https://") {
        bail!("only HTTP and HTTPS URLs are allowed");
    }
    let method = Method::from_bytes(request.method.as_bytes()).context("invalid HTTP method")?;
    let mut builder = client.request(method, &url);
    for header in request.headers.iter().filter(|header| header.enabled) {
        builder = builder.header(&header.key, substitute(&header.value, variables));
    }
    for query in request.query.iter().filter(|query| query.enabled) {
        builder = builder.query(&[(query.key.as_str(), substitute(&query.value, variables))]);
    }
    match &request.auth {
        Auth::None => {}
        Auth::Basic { username, password } => {
            builder = builder.basic_auth(
                substitute(username, variables),
                Some(substitute(password, variables)),
            );
        }
        Auth::Bearer { token } => {
            builder = builder.bearer_auth(substitute(token, variables));
        }
        Auth::ApiKey {
            key,
            value,
            location,
        } => match location {
            ApiKeyLocation::Header => builder = builder.header(key, substitute(value, variables)),
            ApiKeyLocation::Query => {
                builder = builder.query(&[(key, substitute(value, variables))])
            }
        },
    }
    match request.body_kind {
        BodyKind::Raw => {
            builder = builder.body(substitute(
                request.body.as_deref().unwrap_or_default(),
                variables,
            ))
        }
        BodyKind::UrlEncoded => {
            let values: Vec<KeyValue> =
                serde_json::from_str(request.body.as_deref().unwrap_or("[]"))?;
            let form = values
                .into_iter()
                .filter(|value| value.enabled)
                .map(|value| (value.key, substitute(&value.value, variables)))
                .collect::<Vec<_>>();
            builder = builder.form(&form);
        }
        BodyKind::FormData => {
            let values: Vec<KeyValue> =
                serde_json::from_str(request.body.as_deref().unwrap_or("[]"))?;
            let mut form = reqwest::multipart::Form::new();
            for value in values.into_iter().filter(|value| value.enabled) {
                form = form.text(value.key, substitute(&value.value, variables));
            }
            builder = builder.multipart(form);
        }
        BodyKind::None => {}
    }
    let response = builder.send().await?;
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let headers = response
        .headers()
        .iter()
        .map(|(key, value)| KeyValue {
            key: key.to_string(),
            value: if matches!(
                key.as_str(),
                "set-cookie" | "authorization" | "proxy-authorization"
            ) {
                "[REDACTED]".into()
            } else {
                value.to_str().unwrap_or("[binary]").to_string()
            },
            enabled: true,
        })
        .collect();
    let bytes = response.bytes().await?;
    let body_size = bytes.len() as u64;
    let limit = 5 * 1024 * 1024;
    let truncated = bytes.len() > limit;
    let body = String::from_utf8_lossy(&bytes[..bytes.len().min(limit)]).to_string();
    Ok(ResponseSnapshot {
        status,
        headers,
        content_type,
        body,
        body_hash: None,
        body_size,
        duration_ms: 0,
        truncated,
    })
}

fn evaluate_assertions(request: &ApiRequest, response: &ResponseSnapshot) -> Vec<AssertionResult> {
    request
        .assertions
        .iter()
        .map(|assertion| match assertion {
            ResponseAssertion::StatusEquals { expected, name } => AssertionResult {
                name: name.clone(),
                passed: response.status == *expected,
                message: if response.status == *expected {
                    format!("Status was {expected}")
                } else {
                    format!("Expected status {expected}, received {}", response.status)
                },
            },
        })
        .collect()
}

fn extract_values(request: &ApiRequest, response: &ResponseSnapshot) -> Vec<ExtractedValue> {
    request
        .extractions
        .iter()
        .filter_map(|rule| match rule {
            ExtractionRule::JsonPath { name, path } => {
                let body: serde_json::Value = serde_json::from_str(&response.body).ok()?;
                let value = json_path(&body, path)?;
                Some(ExtractedValue {
                    name: name.clone(),
                    value: value
                        .as_str()
                        .map(str::to_string)
                        .unwrap_or_else(|| value.to_string()),
                    source: path.clone(),
                })
            }
            ExtractionRule::Header { name, header } => response
                .headers
                .iter()
                .find(|item| item.key.eq_ignore_ascii_case(header))
                .map(|item| ExtractedValue {
                    name: name.clone(),
                    value: item.value.clone(),
                    source: format!("header:{header}"),
                }),
        })
        .collect()
}

fn json_path<'a>(value: &'a serde_json::Value, path: &str) -> Option<&'a serde_json::Value> {
    let mut current = value;
    for segment in path.trim_start_matches("$.").split('.') {
        if segment.is_empty() {
            continue;
        }
        current = current.get(segment)?;
    }
    Some(current)
}

fn resolve_variables(
    collection: &Collection,
    environment: Option<&crate::Environment>,
) -> HashMap<String, String> {
    collection
        .variables
        .iter()
        .chain(
            environment
                .into_iter()
                .flat_map(|environment| environment.variables.iter()),
        )
        .filter(|value| value.enabled)
        .map(|value| (value.key.clone(), value.value.clone()))
        .collect()
}

fn substitute(input: &str, variables: &HashMap<String, String>) -> String {
    variables
        .iter()
        .fold(input.to_string(), |value, (key, replacement)| {
            value.replace(&format!("{{{{{key}}}}}"), replacement)
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{header, method, path},
    };

    #[tokio::test]
    async fn runs_and_persists_a_collection() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/health"))
            .and(header("authorization", "Bearer secret"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({"ok":true,"user":{"id":"abc"}})),
            )
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/users/abc"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({"name":"Ada"})),
            )
            .mount(&server)
            .await;
        let store = Store::open(":memory:").unwrap();
        let engine = ApiQaEngine::new(store);
        let collection = Collection {
            id: "c1".into(),
            name: "Demo".into(),
            variables: vec![],
            imported_at: Utc::now(),
            import_warnings: vec![],
            requests: vec![
                ApiRequest {
                    id: "r1".into(),
                    collection_id: "c1".into(),
                    folder_path: vec![],
                    name: "Health".into(),
                    method: "GET".into(),
                    url: format!("{}/health", server.uri()),
                    headers: vec![],
                    query: vec![],
                    body_kind: BodyKind::None,
                    body: None,
                    auth: Auth::Bearer {
                        token: "{{token}}".into(),
                    },
                    assertions: vec![ResponseAssertion::StatusEquals {
                        expected: 200,
                        name: "healthy".into(),
                    }],
                    extractions: vec![ExtractionRule::JsonPath {
                        name: "userId".into(),
                        path: "$.user.id".into(),
                    }],
                    disabled: false,
                },
                ApiRequest {
                    id: "r2".into(),
                    collection_id: "c1".into(),
                    folder_path: vec![],
                    name: "User".into(),
                    method: "GET".into(),
                    url: format!("{}/users/{{{{userId}}}}", server.uri()),
                    headers: vec![],
                    query: vec![],
                    body_kind: BodyKind::None,
                    body: None,
                    auth: Auth::None,
                    assertions: vec![],
                    extractions: vec![],
                    disabled: false,
                },
            ],
        };
        engine.store.save_collection(&collection).unwrap();
        let run = engine
            .run_collection(
                &collection,
                RunOptions {
                    environment: Some(crate::Environment {
                        id: "e1".into(),
                        name: "Test".into(),
                        variables: vec![KeyValue {
                            key: "token".into(),
                            value: "secret".into(),
                            enabled: true,
                        }],
                    }),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(run.state, RunState::Completed);
        assert_eq!(run.executions[0].response.as_ref().unwrap().status, 200);
        assert!(run.executions[0].assertions[0].passed);
        assert_eq!(run.executions[0].extractions[0].value, "abc");
        assert_eq!(run.executions.len(), 2);
    }
}
