# Changelog

All notable changes to APIQA are documented here.

## [1.0.1] - 2026-07-22

### Fixed

- Unsigned community builds no longer receive empty signing environment variables.
- Cross-platform release linking now uses thin LTO and additional codegen units to fit hosted-runner memory limits.

## [1.0.0] - 2026-07-22

### Added

- Production release workflow for native macOS Apple Silicon, macOS Intel, Windows, and Linux installers.
- Automated GitHub Release creation and consistently named platform assets.
- User installation, first-run, CLI automation, privacy, and security documentation.

### Changed

- Promoted the desktop application from beta to the stable 1.0 product line.
- Release packaging now supports optional Apple notarization and updater-signing credentials.

## [0.5.0] - 2026-07-22

### Added

- Accessible in-app request authoring for new and imported endpoints.
- History retention and storage-limit settings with immediate safe cleanup.
- Portable `.apiqa` project export and import commands for team handoff.
- Secret-value omission from exported project environments.
- Privacy-safe CLI diagnostics for support and database health checks.

### Changed

- Endpoint rows now open directly in the request editor.
- Pinned baselines remain protected when users clean history manually.

## [0.4.0] - 2026-07-22

### Added

- Run-scoped JSON-path and response-header extraction rules.
- Safe translation of common Postman variable extraction scripts.
- Serial value chaining from one response into later request URLs, headers, auth, queries, and bodies.
- CLI environment and explicit baseline selection.
- Redacted HTML, JSON, and JUnit automation reports.
- Stable CI exit codes for regression, assertion, and transport failures.
- CLI history, environment listing, and retention-clean commands.
- Extracted-value visibility in desktop run details.

### Security

- Extracted runtime values are redacted from exported JSON reports.

## [0.3.0] - 2026-07-22

### Added

- SHA-256 content-addressed response storage with zstd compression.
- Transparent response hydration when historical runs are opened.
- Configurable age and size retention policy with a 30-day default.
- Pinned baselines that are exempt from automatic cleanup.
- Transactional whole-run cleanup and unreferenced blob garbage collection.
- Startup database integrity checking.
- Immutable versioned comparison-rule storage.
- Desktop commands for pinning, retention settings, and manual cleanup.

### Changed

- Retention cleanup now runs at application startup and after completed runs.
- Repeated identical response bodies occupy storage only once.

## [0.2.0] - 2026-07-22

### Added

- Stable Postman collection and request identities for safe re-import updates.
- Postman environment import and active-environment selection.
- Basic, Bearer, and API-key authentication with variable substitution.
- URL-encoded and multipart text request bodies.
- Engine-level HTTP/HTTPS proxy and invalid-certificate controls.
- Safe translation and evaluation of common `pm.response.to.have.status(...)` tests.
- Assertion failures as first-class run outcomes.

### Changed

- Unsupported Postman scripts produce request-specific migration warnings.
- Imported collection IDs now prefer Postman's stable `_postman_id`.

## [0.1.0] - 2026-07-22

### Added

- Cross-platform Tauri desktop shell and React interface.
- Postman Collection v2.0/v2.1 import with nested folders, variables, headers, queries, and raw bodies.
- Shared Rust HTTP engine with serial collection execution and variable substitution.
- Local SQLite collection and run history.
- Automatic comparison with the preceding run.
- Structural JSON, header, status, text, and timing differences.
- Redaction of sensitive response headers before persistence.
- Collection, history, regression report, response, and diff views.
- Companion `apiqa` CLI for imports and automated runs.
- macOS, Windows, and Linux CI checks.
