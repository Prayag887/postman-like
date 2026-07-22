use anyhow::{Context, Result, bail};
use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::{Collection, Environment};

const BUNDLE_FORMAT: &str = "apiqa.project.v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectBundle {
    pub format: String,
    pub exported_at: String,
    pub collection: Collection,
    pub environments: Vec<Environment>,
}

pub fn export_project(collection: &Collection, environments: &[Environment]) -> Result<String> {
    let environments = environments
        .iter()
        .cloned()
        .map(|mut environment| {
            for variable in &mut environment.variables {
                if is_secret(&variable.key) {
                    variable.value.clear();
                }
            }
            environment
        })
        .collect();
    serde_json::to_string_pretty(&ProjectBundle {
        format: BUNDLE_FORMAT.into(),
        exported_at: Utc::now().to_rfc3339(),
        collection: collection.clone(),
        environments,
    })
    .context("encode APIQA project")
}

pub fn import_project(source: &str) -> Result<ProjectBundle> {
    let bundle: ProjectBundle = serde_json::from_str(source).context("decode APIQA project")?;
    if bundle.format != BUNDLE_FORMAT {
        bail!("unsupported APIQA project format: {}", bundle.format);
    }
    Ok(bundle)
}

fn is_secret(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    ["token", "secret", "password", "passwd", "api_key", "apikey"]
        .iter()
        .any(|candidate| key.contains(candidate))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::KeyValue;

    #[test]
    fn project_round_trip_strips_secret_values() {
        let collection = Collection {
            id: "collection".into(),
            name: "Demo".into(),
            requests: vec![],
            variables: vec![],
            imported_at: Utc::now(),
            import_warnings: vec![],
        };
        let environment = Environment {
            id: "environment".into(),
            name: "Staging".into(),
            variables: vec![KeyValue {
                key: "API_TOKEN".into(),
                value: "do-not-export".into(),
                enabled: true,
            }],
        };
        let encoded = export_project(&collection, &[environment]).unwrap();
        assert!(!encoded.contains("do-not-export"));
        let decoded = import_project(&encoded).unwrap();
        assert_eq!(decoded.collection.name, "Demo");
        assert_eq!(decoded.environments[0].variables[0].value, "");
    }
}
