use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ComparisonCompatibility {
    Exact,
    Compatible,
    PossiblyIncompatible,
    Incompatible,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DifferenceSeverity {
    Critical,
    Warning,
    Informational,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DifferenceKind {
    StatusChanged,
    FieldAdded,
    FieldRemoved,
    TypeChanged,
    ValueChanged,
    NullabilityChanged,
    ArrayLengthChanged,
    ArrayOrderChanged,
    HeaderAdded,
    HeaderRemoved,
    HeaderChanged,
    ContentTypeChanged,
    BodyBecameMalformed,
    BodyHashChanged,
    LatencyRegressed,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisplayValue(pub String);
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Difference {
    pub kind: DifferenceKind,
    pub path: Option<String>,
    pub previous: Option<DisplayValue>,
    pub current: Option<DisplayValue>,
    pub severity: DifferenceSeverity,
    pub ignored: bool,
    pub explanation: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResponseComparison {
    pub baseline_transaction_id: Option<uuid::Uuid>,
    pub compatibility: ComparisonCompatibility,
    pub differences: Vec<Difference>,
}

impl ResponseComparison {
    pub fn changed(&self) -> bool {
        self.differences
            .iter()
            .any(|difference| !difference.ignored)
    }
    pub fn critical_count(&self) -> usize {
        self.differences
            .iter()
            .filter(|d| !d.ignored && d.severity == DifferenceSeverity::Critical)
            .count()
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ComparisonRules {
    pub ignored_json_pointers: BTreeSet<String>,
    pub volatile_keys: BTreeSet<String>,
}

pub fn canonicalize_json(value: &Value, rules: &ComparisonRules) -> Value {
    canonicalize_at(value, "$", rules)
}

fn canonicalize_at(value: &Value, path: &str, rules: &ComparisonRules) -> Value {
    match value {
        Value::Object(map) => {
            let sorted = map
                .iter()
                .filter_map(|(key, value)| {
                    let child = format!("{path}.{}", key);
                    if rules.ignored_json_pointers.contains(&child)
                        || rules
                            .volatile_keys
                            .iter()
                            .any(|candidate| candidate.eq_ignore_ascii_case(key))
                    {
                        None
                    } else {
                        Some((key.clone(), canonicalize_at(value, &child, rules)))
                    }
                })
                .collect::<BTreeMap<_, _>>();
            Value::Object(sorted.into_iter().collect())
        }
        Value::Array(values) => Value::Array(
            values
                .iter()
                .enumerate()
                .map(|(index, value)| canonicalize_at(value, &format!("{path}[{index}]"), rules))
                .collect(),
        ),
        _ => value.clone(),
    }
}

pub fn compare_json(previous: &Value, current: &Value, rules: &ComparisonRules) -> Vec<Difference> {
    let mut differences = Vec::new();
    diff_value(
        &canonicalize_json(previous, rules),
        &canonicalize_json(current, rules),
        "$",
        &mut differences,
    );
    differences
}

fn display(value: &Value) -> DisplayValue {
    DisplayValue(serde_json::to_string(value).unwrap_or_else(|_| "<unavailable>".into()))
}
fn kind_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}
fn difference(
    kind: DifferenceKind,
    path: &str,
    previous: Option<&Value>,
    current: Option<&Value>,
    severity: DifferenceSeverity,
    explanation: String,
) -> Difference {
    Difference {
        kind,
        path: Some(path.into()),
        previous: previous.map(display),
        current: current.map(display),
        severity,
        ignored: false,
        explanation,
    }
}
fn diff_value(previous: &Value, current: &Value, path: &str, out: &mut Vec<Difference>) {
    if previous == current {
        return;
    }
    if std::mem::discriminant(previous) != std::mem::discriminant(current) {
        let kind = if previous.is_null() || current.is_null() {
            DifferenceKind::NullabilityChanged
        } else {
            DifferenceKind::TypeChanged
        };
        out.push(difference(
            kind,
            path,
            Some(previous),
            Some(current),
            DifferenceSeverity::Critical,
            format!(
                "Type changed: {} → {}",
                kind_name(previous),
                kind_name(current)
            ),
        ));
        return;
    }
    match (previous, current) {
        (Value::Object(before), Value::Object(after)) => {
            for key in before.keys().chain(after.keys()).collect::<BTreeSet<_>>() {
                let child = format!("{path}.{key}");
                match (before.get(key), after.get(key)) {
                    (Some(left), Some(right)) => diff_value(left, right, &child, out),
                    (Some(left), None) => out.push(difference(
                        DifferenceKind::FieldRemoved,
                        &child,
                        Some(left),
                        None,
                        DifferenceSeverity::Critical,
                        "Field was removed".into(),
                    )),
                    (None, Some(right)) => out.push(difference(
                        DifferenceKind::FieldAdded,
                        &child,
                        None,
                        Some(right),
                        DifferenceSeverity::Informational,
                        "Field was added".into(),
                    )),
                    _ => {}
                }
            }
        }
        (Value::Array(before), Value::Array(after)) => {
            if before.len() != after.len() {
                out.push(difference(
                    DifferenceKind::ArrayLengthChanged,
                    path,
                    Some(previous),
                    Some(current),
                    DifferenceSeverity::Warning,
                    format!("Array length changed: {} → {}", before.len(), after.len()),
                ));
            }
            for (index, (left, right)) in before.iter().zip(after).enumerate() {
                diff_value(left, right, &format!("{path}[{index}]"), out);
            }
        }
        _ => out.push(difference(
            DifferenceKind::ValueChanged,
            path,
            Some(previous),
            Some(current),
            DifferenceSeverity::Warning,
            "Value changed".into(),
        )),
    }
}

pub fn compatibility(
    previous: &crate::traffic::EndpointIdentity,
    current: &crate::traffic::EndpointIdentity,
) -> ComparisonCompatibility {
    if previous.method != current.method
        || previous.host != current.host
        || previous.path_template != current.path_template
    {
        return ComparisonCompatibility::Incompatible;
    }
    if previous.content_type != current.content_type {
        return ComparisonCompatibility::PossiblyIncompatible;
    }
    if previous.request_shape == current.request_shape {
        ComparisonCompatibility::Exact
    } else {
        ComparisonCompatibility::Compatible
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn canonicalization_ignores_configured_volatility() {
        let rules = ComparisonRules {
            volatile_keys: ["timestamp".into()].into(),
            ..Default::default()
        };
        assert_eq!(
            canonicalize_json(&serde_json::json!({"b":2,"timestamp":1,"a":1}), &rules),
            serde_json::json!({"a":1,"b":2})
        );
    }
    #[test]
    fn detects_removed_type_and_nullability() {
        let differences = compare_json(
            &serde_json::json!({"a":"x","b":1,"c":true}),
            &serde_json::json!({"a":{},"b":null}),
            &ComparisonRules::default(),
        );
        assert!(
            differences
                .iter()
                .any(|d| d.kind == DifferenceKind::TypeChanged)
        );
        assert!(
            differences
                .iter()
                .any(|d| d.kind == DifferenceKind::NullabilityChanged)
        );
        assert!(
            differences
                .iter()
                .any(|d| d.kind == DifferenceKind::FieldRemoved)
        );
    }
}
