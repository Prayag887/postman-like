# APIQA

APIQA is a local-first, cross-platform API quality-assurance client. Import a Postman collection, run its requests serially, retain response history, and compare current behavior with an earlier baseline.

## What you can do

- Import Postman Collection v2.0/v2.1 files and Postman environments.
- Author and edit HTTP requests with variables, bodies, authentication, assertions, and response extraction preserved from imports.
- Run complete collections serially and pass extracted values into later requests.
- Compare status, headers, JSON structure and values, text, and response timing with any retained baseline.
- Keep 7–90 days of compressed, de-duplicated history, with optional storage limits and protected pinned baselines.
- Export HTML, JSON, and JUnit automation reports, with deterministic CLI exit codes for CI.
- Move projects between machines with `.apiqa` files that omit secret-like environment values.

## Install

Download the installer for your platform from [GitHub Releases](https://github.com/Prayag887/postman-like/releases):

- macOS Apple Silicon or Intel: `.dmg`
- Windows: setup `.exe`
- Linux (Debian, Ubuntu, and derivatives): `.deb`

On first launch, import a Postman collection, choose an optional environment, and select **Run collection**. The first run is your baseline; later runs show exactly which endpoints changed. Use Settings to select the history window.

## Development

Requirements: Rust 1.96+, Node 24+, pnpm 11+, and the platform prerequisites for Tauri 2.

```bash
pnpm install
pnpm dev
```

Run all checks:

```bash
pnpm check
```

The desktop application uses the shared Rust engine in `crates/apiqa-core`. The companion CLI in `apps/cli` uses the same engine.

## Data and privacy

APIQA stores projects and response history locally. Authorization and cookie headers are redacted before persistence. No telemetry is sent.

Project exports intentionally blank variable names containing `token`, `secret`, `password`, or `api_key`. Review any report or project before sharing it because request and response bodies may still contain business-sensitive data.

## CLI automation

```bash
cargo run -p apiqa -- import collection.json
cargo run -p apiqa -- run COLLECTION_ID --environment ENVIRONMENT_ID --report-dir reports
cargo run -p apiqa -- export-project COLLECTION_ID team-project.apiqa
cargo run -p apiqa -- diagnostics
```

Run exit codes are `0` for unchanged, `2` for response changes, `3` for assertion failures, and `4` for transport failures.

## Release builds

Push a version tag such as `v1.0.4`. GitHub Actions builds and publishes native artifacts for macOS (Apple Silicon and Intel), Windows, and Linux. The default workflow creates unsigned community builds. Before commercial distribution, add a separate signed release job using the Apple notarization and Windows code-signing credentials described by Tauri's platform guides.
