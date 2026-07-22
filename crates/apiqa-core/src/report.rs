use anyhow::Result;

use crate::{ExecutionState, Run};

pub fn json_report(run: &Run) -> Result<String> {
    let mut redacted = run.clone();
    for execution in &mut redacted.executions {
        for extracted in &mut execution.extractions {
            extracted.value = "[REDACTED]".into();
        }
    }
    Ok(serde_json::to_string_pretty(&redacted)?)
}

pub fn html_report(run: &Run) -> String {
    let changed = run
        .executions
        .iter()
        .filter(|item| item.state == ExecutionState::Changed)
        .count();
    let failed = run
        .executions
        .iter()
        .filter(|item| {
            matches!(
                item.state,
                ExecutionState::TransportFailed | ExecutionState::AssertionFailed
            )
        })
        .count();
    let rows = run.executions.iter().map(|execution| {
        let status = execution.response.as_ref().map(|response| response.status.to_string()).unwrap_or_else(|| "—".into());
        let duration = execution.response.as_ref().map(|response| format!("{} ms", response.duration_ms)).unwrap_or_else(|| "—".into());
        format!("<tr><td>{}</td><td><span class=\"state {}\">{:?}</span></td><td>{}</td><td>{}</td><td>{}</td></tr>",
            escape(&execution.request_name), format!("{:?}", execution.state).to_lowercase(), execution.state,
            status, duration, escape(execution.error.as_deref().unwrap_or_default()))
    }).collect::<String>();
    format!(
        r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>APIQA report · {name}</title><style>
body{{font:14px system-ui;background:#0b0b0d;color:#e8e8eb;margin:0;padding:40px}}main{{max-width:1100px;margin:auto}}h1{{font-size:28px}}p{{color:#92929d}}.stats{{display:flex;gap:12px;margin:25px 0}}.stat{{background:#151519;border:1px solid #29292e;padding:15px 20px;border-radius:8px}}.stat b{{display:block;font-size:24px;margin-top:4px}}table{{width:100%;border-collapse:collapse;background:#111114;border:1px solid #29292e}}th,td{{text-align:left;padding:12px;border-bottom:1px solid #25252a}}th{{color:#85858f;font-size:11px}}.state{{font-size:10px;text-transform:uppercase}}.state.changed{{color:#fbbf24}}.state.transportfailed,.state.assertionfailed{{color:#fb7185}}footer{{margin-top:20px;color:#686872;font-size:11px}}</style></head><body><main><p>APIQA AUTOMATION REPORT</p><h1>{name}</h1><p>Run {id} · {date}</p><div class="stats"><div class="stat">Endpoints<b>{total}</b></div><div class="stat">Changed<b>{changed}</b></div><div class="stat">Failed<b>{failed}</b></div></div><table><thead><tr><th>Endpoint</th><th>Result</th><th>Status</th><th>Duration</th><th>Error</th></tr></thead><tbody>{rows}</tbody></table><footer>Generated locally by APIQA. Sensitive response headers are redacted before storage and export.</footer></main></body></html>"#,
        name = escape(&run.collection_name),
        id = escape(&run.id),
        date = escape(&run.started_at.to_rfc3339()),
        total = run.executions.len()
    )
}

pub fn junit_report(run: &Run) -> String {
    let failures = run
        .executions
        .iter()
        .filter(|execution| {
            matches!(
                execution.state,
                ExecutionState::TransportFailed
                    | ExecutionState::AssertionFailed
                    | ExecutionState::Changed
            )
        })
        .count();
    let cases = run
        .executions
        .iter()
        .map(|execution| {
            let seconds = execution
                .response
                .as_ref()
                .map(|response| response.duration_ms as f64 / 1000.0)
                .unwrap_or_default();
            let failure = if matches!(execution.state, ExecutionState::Passed) {
                String::new()
            } else {
                let detail = execution
                    .error
                    .clone()
                    .or_else(|| {
                        execution.comparison.as_ref().map(|comparison| {
                            format!("{} response differences", comparison.differences.len())
                        })
                    })
                    .unwrap_or_else(|| "assertion failed".into());
                format!(
                    "<failure message=\"{}\">{}</failure>",
                    escape(&detail),
                    escape(&detail)
                )
            };
            format!(
                "<testcase classname=\"{}\" name=\"{}\" time=\"{seconds:.3}\">{failure}</testcase>",
                escape(&run.collection_name),
                escape(&execution.request_name)
            )
        })
        .collect::<String>();
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><testsuite name=\"{}\" tests=\"{}\" failures=\"{}\">{}</testsuite>",
        escape(&run.collection_name),
        run.executions.len(),
        failures,
        cases
    )
}

fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::RunState;
    use chrono::Utc;

    #[test]
    fn escapes_report_content() {
        let run = Run {
            id: "r1".into(),
            collection_id: "c1".into(),
            collection_name: "<Demo>".into(),
            environment_name: None,
            started_at: Utc::now(),
            completed_at: Some(Utc::now()),
            state: RunState::Completed,
            baseline_run_id: None,
            executions: vec![],
            pinned: false,
        };
        assert!(html_report(&run).contains("&lt;Demo&gt;"));
        assert!(junit_report(&run).contains("&lt;Demo&gt;"));
    }
}
