# APIQA

APIQA is a local-first, cross-platform API quality-assurance client. Import a Postman collection, run its requests serially, retain response history, and compare current behavior with an earlier baseline.

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

## Release builds

Push a version tag such as `v0.1.0`. GitHub Actions builds native artifacts on macOS, Windows, and Linux. Signing secrets are optional for preview builds and required for a public `v1.0.0` release.
