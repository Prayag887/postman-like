use std::collections::{BTreeMap, HashSet};

use serde_json::Value;

use crate::{Difference, DifferenceKind, ResponseComparison, ResponseSnapshot};

#[derive(Debug, Clone, Default)]
pub struct ComparisonOptions {
    pub ignored_json_paths: HashSet<String>,
    pub ignored_headers: HashSet<String>,
}

pub fn compare_responses(
    baseline: &ResponseSnapshot,
    current: &ResponseSnapshot,
    options: &ComparisonOptions,
) -> ResponseComparison {
    let mut differences = Vec::new();

    if baseline.status != current.status {
        differences.push(Difference {
            kind: DifferenceKind::Status,
            path: "$status".into(),
            baseline: Some(Value::from(baseline.status)),
            current: Some(Value::from(current.status)),
            message: format!(
                "Status changed from {} to {}",
                baseline.status, current.status
            ),
        });
    }

    compare_headers(baseline, current, options, &mut differences);

    match (
        serde_json::from_str::<Value>(&baseline.body),
        serde_json::from_str::<Value>(&current.body),
    ) {
        (Ok(left), Ok(right)) => compare_json("$", &left, &right, options, &mut differences),
        _ if baseline.body != current.body => differences.push(Difference {
            kind: DifferenceKind::TextChanged,
            path: "$body".into(),
            baseline: Some(Value::String(baseline.body.clone())),
            current: Some(Value::String(current.body.clone())),
            message: "Response body changed".into(),
        }),
        _ => {}
    }

    if current.duration_ms >= baseline.duration_ms.saturating_add(500)
        && current.duration_ms >= baseline.duration_ms.saturating_mul(3) / 2
    {
        differences.push(Difference {
            kind: DifferenceKind::Timing,
            path: "$timing.total_ms".into(),
            baseline: Some(Value::from(baseline.duration_ms)),
            current: Some(Value::from(current.duration_ms)),
            message: format!(
                "Response slowed from {} ms to {} ms",
                baseline.duration_ms, current.duration_ms
            ),
        });
    }

    ResponseComparison {
        changed: !differences.is_empty(),
        differences,
    }
}

fn compare_headers(
    baseline: &ResponseSnapshot,
    current: &ResponseSnapshot,
    options: &ComparisonOptions,
    differences: &mut Vec<Difference>,
) {
    let normalize = |headers: &[crate::KeyValue]| {
        headers
            .iter()
            .filter(|header| {
                !options
                    .ignored_headers
                    .contains(&header.key.to_ascii_lowercase())
            })
            .map(|header| (header.key.to_ascii_lowercase(), header.value.clone()))
            .collect::<BTreeMap<_, _>>()
    };
    let left = normalize(&baseline.headers);
    let right = normalize(&current.headers);
    for key in left.keys().chain(right.keys()).collect::<HashSet<_>>() {
        if left.get(key) != right.get(key) {
            differences.push(Difference {
                kind: DifferenceKind::Header,
                path: format!("$headers.{key}"),
                baseline: left.get(key).cloned().map(Value::String),
                current: right.get(key).cloned().map(Value::String),
                message: format!("Header {key} changed"),
            });
        }
    }
}

fn compare_json(
    path: &str,
    baseline: &Value,
    current: &Value,
    options: &ComparisonOptions,
    differences: &mut Vec<Difference>,
) {
    if options.ignored_json_paths.contains(path) {
        return;
    }
    match (baseline, current) {
        (Value::Object(left), Value::Object(right)) => {
            let keys = left.keys().chain(right.keys()).collect::<HashSet<_>>();
            for key in keys {
                let child = format!("{path}.{key}");
                match (left.get(key), right.get(key)) {
                    (Some(a), Some(b)) => compare_json(&child, a, b, options, differences),
                    (Some(a), None) => differences.push(Difference {
                        kind: DifferenceKind::Removed,
                        path: child,
                        baseline: Some(a.clone()),
                        current: None,
                        message: format!("Field {key} was removed"),
                    }),
                    (None, Some(b)) => differences.push(Difference {
                        kind: DifferenceKind::Added,
                        path: child,
                        baseline: None,
                        current: Some(b.clone()),
                        message: format!("Field {key} was added"),
                    }),
                    _ => {}
                }
            }
        }
        (Value::Array(left), Value::Array(right)) => {
            for index in 0..left.len().max(right.len()) {
                let child = format!("{path}[{index}]");
                match (left.get(index), right.get(index)) {
                    (Some(a), Some(b)) => compare_json(&child, a, b, options, differences),
                    (Some(a), None) => differences.push(Difference {
                        kind: DifferenceKind::Removed,
                        path: child,
                        baseline: Some(a.clone()),
                        current: None,
                        message: "Array item was removed".into(),
                    }),
                    (None, Some(b)) => differences.push(Difference {
                        kind: DifferenceKind::Added,
                        path: child,
                        baseline: None,
                        current: Some(b.clone()),
                        message: "Array item was added".into(),
                    }),
                    _ => {}
                }
            }
        }
        _ if std::mem::discriminant(baseline) != std::mem::discriminant(current) => {
            differences.push(Difference {
                kind: DifferenceKind::TypeChanged,
                path: path.into(),
                baseline: Some(baseline.clone()),
                current: Some(current.clone()),
                message: "Value type changed".into(),
            });
        }
        _ if baseline != current => differences.push(Difference {
            kind: DifferenceKind::ValueChanged,
            path: path.into(),
            baseline: Some(baseline.clone()),
            current: Some(current.clone()),
            message: "Value changed".into(),
        }),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn response(body: &str) -> ResponseSnapshot {
        ResponseSnapshot {
            status: 200,
            headers: vec![],
            content_type: Some("application/json".into()),
            body: body.into(),
            body_size: body.len() as u64,
            duration_ms: 10,
            truncated: false,
        }
    }

    #[test]
    fn ignores_json_key_order() {
        let result = compare_responses(
            &response(r#"{"a":1,"b":2}"#),
            &response(r#"{"b":2,"a":1}"#),
            &ComparisonOptions::default(),
        );
        assert!(!result.changed);
    }

    #[test]
    fn reports_nested_value_change() {
        let result = compare_responses(
            &response(r#"{"user":{"name":"Ada"}}"#),
            &response(r#"{"user":{"name":"Grace"}}"#),
            &ComparisonOptions::default(),
        );
        assert_eq!(result.differences[0].path, "$.user.name");
    }
}
