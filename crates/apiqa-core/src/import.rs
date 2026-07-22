use anyhow::{Context, Result, bail};
use chrono::Utc;
use serde_json::Value;
use uuid::Uuid;

use crate::{ApiRequest, BodyKind, Collection, KeyValue};

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

    let collection_id = Uuid::new_v4().to_string();
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
        if item.get("event").is_some() || request.get("event").is_some() {
            warnings.push(format!("{name}: scripts are not executed in v0.1"));
        }
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
            disabled: item
                .get("disabled")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        });
    }
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
}
