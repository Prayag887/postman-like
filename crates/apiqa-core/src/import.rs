use anyhow::{Context, Result, bail};
use chrono::Utc;
use regex::Regex;
use serde_json::Value;
use uuid::Uuid;

use crate::{
    ApiKeyLocation, ApiRequest, Auth, BodyKind, Collection, Environment, ExtractionRule, KeyValue,
    ResponseAssertion,
};

pub fn import_postman(json: &str) -> Result<Collection> {
    if json.len() > 50 * 1024 * 1024 {
        bail!("Postman collection exceeds the 50 MiB import limit");
    }
    let root: Value = serde_json::from_str(json).context("invalid Postman JSON")?;
    let name = root
        .pointer("/info/name")
        .and_then(Value::as_str)
        .unwrap_or("Imported collection")
        .to_string();
    let schema = root
        .pointer("/info/schema")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !schema.contains("v2.0") && !schema.contains("v2.1") {
        bail!("only Postman Collection v2.0 and v2.1 are supported");
    }

    let collection_id = root
        .pointer("/info/_postman_id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let mut requests = Vec::new();
    let mut warnings = Vec::new();
    walk_items(
        root.get("item").and_then(Value::as_array),
        &collection_id,
        &[],
        &mut requests,
        &mut warnings,
    );

    let variables = root
        .get("variable")
        .and_then(Value::as_array)
        .map(|values| values.iter().filter_map(postman_key_value).collect())
        .unwrap_or_default();

    Ok(Collection {
        id: collection_id,
        name,
        requests,
        variables,
        imported_at: Utc::now(),
        import_warnings: warnings,
    })
}

pub fn import_postman_environment(json: &str) -> Result<Environment> {
    if json.len() > 10 * 1024 * 1024 {
        bail!("Postman environment exceeds the 10 MiB import limit");
    }
    let root: Value = serde_json::from_str(json).context("invalid Postman environment JSON")?;
    let name = root
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("Imported environment")
        .to_string();
    let id = root
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let variables = root
        .get("values")
        .and_then(Value::as_array)
        .map(|values| values.iter().filter_map(postman_key_value).collect())
        .unwrap_or_default();
    Ok(Environment {
        id,
        name,
        variables,
    })
}

fn walk_items(
    items: Option<&Vec<Value>>,
    collection_id: &str,
    path: &[String],
    requests: &mut Vec<ApiRequest>,
    warnings: &mut Vec<String>,
) {
    for item in items.into_iter().flatten() {
        let name = item
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("Untitled");
        if let Some(children) = item.get("item").and_then(Value::as_array) {
            let mut next = path.to_vec();
            next.push(name.to_string());
            walk_items(Some(children), collection_id, &next, requests, warnings);
            continue;
        }
        let Some(request) = item.get("request") else {
            continue;
        };
        let url = parse_url(request.get("url"));
        let body = request.get("body");
        let body_kind = match body
            .and_then(|body| body.get("mode"))
            .and_then(Value::as_str)
        {
            Some("raw") => BodyKind::Raw,
            Some("urlencoded") => BodyKind::UrlEncoded,
            Some("formdata") => BodyKind::FormData,
            _ => BodyKind::None,
        };
        let body_value = match body_kind {
            BodyKind::Raw => body
                .and_then(|body| body.get("raw"))
                .and_then(Value::as_str)
                .map(str::to_string),
            BodyKind::UrlEncoded | BodyKind::FormData => body
                .and_then(|body| {
                    body.get(match body_kind {
                        BodyKind::UrlEncoded => "urlencoded",
                        _ => "formdata",
                    })
                })
                .and_then(Value::as_array)
                .map(|values| {
                    values
                        .iter()
                        .filter_map(postman_key_value)
                        .collect::<Vec<_>>()
                })
                .and_then(|values| serde_json::to_string(&values).ok()),
            BodyKind::None => None,
        };
        let (assertions, extractions, script_warnings) =
            parse_assertions(item.get("event").and_then(Value::as_array));
        warnings.extend(
            script_warnings
                .into_iter()
                .map(|warning| format!("{name}: {warning}")),
        );
        requests.push(ApiRequest {
            id: item
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string()
                .pipe(|id| {
                    if id.is_empty() {
                        Uuid::new_v4().to_string()
                    } else {
                        id
                    }
                }),
            collection_id: collection_id.to_string(),
            folder_path: path.to_vec(),
            name: name.to_string(),
            method: request
                .get("method")
                .and_then(Value::as_str)
                .unwrap_or("GET")
                .to_ascii_uppercase(),
            url,
            headers: request
                .get("header")
                .and_then(Value::as_array)
                .map(|values| values.iter().filter_map(postman_key_value).collect())
                .unwrap_or_default(),
            query: parse_query(request.get("url")),
            body_kind,
            body: body_value,
            auth: parse_auth(request.get("auth")),
            assertions,
            extractions,
            disabled: item
                .get("disabled")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        });
    }
}

fn parse_auth(value: Option<&Value>) -> Auth {
    let Some(auth) = value else {
        return Auth::None;
    };
    let kind = auth.get("type").and_then(Value::as_str).unwrap_or_default();
    let values = auth.get(kind).and_then(Value::as_array);
    let get = |key: &str| {
        values
            .into_iter()
            .flatten()
            .find(|entry| entry.get("key").and_then(Value::as_str) == Some(key))
            .and_then(|entry| entry.get("value"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    match kind {
        "basic" => Auth::Basic {
            username: get("username"),
            password: get("password"),
        },
        "bearer" => Auth::Bearer {
            token: get("token"),
        },
        "apikey" => Auth::ApiKey {
            key: get("key"),
            value: get("value"),
            location: if get("in").eq_ignore_ascii_case("query") {
                ApiKeyLocation::Query
            } else {
                ApiKeyLocation::Header
            },
        },
        _ => Auth::None,
    }
}

fn parse_assertions(
    events: Option<&Vec<Value>>,
) -> (Vec<ResponseAssertion>, Vec<ExtractionRule>, Vec<String>) {
    let status_pattern =
        Regex::new(r#"pm\.response\.to\.have\.status\((\d{3})\)"#).expect("status regex");
    let name_pattern = Regex::new(r#"pm\.test\(\s*[\"']([^\"']+)[\"']"#).expect("name regex");
    let extraction_pattern = Regex::new(
        r#"pm\.(?:environment|collectionVariables|variables)\.set\(\s*[\"']([^\"']+)[\"']\s*,\s*pm\.response\.json\(\)\.([A-Za-z0-9_.]+)\s*\)"#,
    )
    .expect("extraction regex");
    let mut assertions = Vec::new();
    let mut extractions = Vec::new();
    let mut warnings = Vec::new();
    for event in events
        .into_iter()
        .flatten()
        .filter(|event| event.get("listen").and_then(Value::as_str) == Some("test"))
    {
        let lines = event
            .pointer("/script/exec")
            .and_then(Value::as_array)
            .map(|lines| {
                lines
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_default();
        let mut matched = 0;
        for capture in status_pattern.captures_iter(&lines) {
            let expected = capture[1].parse::<u16>().unwrap_or_default();
            let name = name_pattern
                .captures(&lines)
                .map(|capture| capture[1].to_string())
                .unwrap_or_else(|| format!("Status is {expected}"));
            assertions.push(ResponseAssertion::StatusEquals { expected, name });
            matched += 1;
        }
        for capture in extraction_pattern.captures_iter(&lines) {
            extractions.push(ExtractionRule::JsonPath {
                name: capture[1].to_string(),
                path: format!("$.{}", &capture[2]),
            });
            matched += 1;
        }
        if !lines.trim().is_empty() && matched == 0 {
            warnings.push("unsupported test script was skipped".into());
        }
    }
    (assertions, extractions, warnings)
}

fn parse_url(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(url)) => url.clone(),
        Some(Value::Object(url)) => url
            .get("raw")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| {
                let protocol = url
                    .get("protocol")
                    .and_then(Value::as_str)
                    .unwrap_or("https");
                let host = url
                    .get("host")
                    .and_then(Value::as_array)
                    .map(|parts| {
                        parts
                            .iter()
                            .filter_map(Value::as_str)
                            .collect::<Vec<_>>()
                            .join(".")
                    })
                    .unwrap_or_default();
                let path = url
                    .get("path")
                    .and_then(Value::as_array)
                    .map(|parts| {
                        parts
                            .iter()
                            .filter_map(Value::as_str)
                            .collect::<Vec<_>>()
                            .join("/")
                    })
                    .unwrap_or_default();
                format!("{protocol}://{host}/{path}")
            }),
        _ => String::new(),
    }
}

fn parse_query(value: Option<&Value>) -> Vec<KeyValue> {
    value
        .and_then(|value| value.get("query"))
        .and_then(Value::as_array)
        .map(|values| values.iter().filter_map(postman_key_value).collect())
        .unwrap_or_default()
}

fn postman_key_value(value: &Value) -> Option<KeyValue> {
    Some(KeyValue {
        key: value.get("key")?.as_str()?.to_string(),
        value: value
            .get("value")
            .map(|value| {
                value
                    .as_str()
                    .map(str::to_string)
                    .unwrap_or_else(|| value.to_string())
            })
            .unwrap_or_default(),
        enabled: !value
            .get("disabled")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

trait Pipe: Sized {
    fn pipe<T>(self, f: impl FnOnce(Self) -> T) -> T {
        f(self)
    }
}
impl<T> Pipe for T {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_nested_v21_collection() {
        let collection = import_postman(r#"{
          "info":{"name":"Demo","schema":"https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},
          "item":[{"name":"Users","item":[{"name":"List","request":{"method":"GET","url":{"raw":"https://example.com/users","query":[]}}}]}]
        }"#).unwrap();
        assert_eq!(collection.name, "Demo");
        assert_eq!(collection.requests[0].folder_path, vec!["Users"]);
        assert_eq!(collection.requests[0].url, "https://example.com/users");
    }

    #[test]
    fn imports_environment_and_safe_status_assertion() {
        let environment = import_postman_environment(
            r#"{"id":"staging","name":"Staging","values":[{"key":"host","value":"https://example.com","enabled":true}]}"#,
        )
        .unwrap();
        assert_eq!(environment.id, "staging");
        assert!(environment.variables[0].enabled);

        let collection = import_postman(
            r#"{"info":{"_postman_id":"stable","name":"Tests","schema":"https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},"item":[{"name":"Health","request":{"method":"GET","url":"https://example.com"},"event":[{"listen":"test","script":{"exec":["pm.test('healthy', function () { pm.response.to.have.status(204); });"]}}]}]}"#,
        )
        .unwrap();
        assert_eq!(collection.id, "stable");
        assert_eq!(collection.requests[0].assertions.len(), 1);
    }
}
