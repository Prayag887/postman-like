# Changelog

All notable changes to APIQA are documented here.

## [1.3.0] - 2026-07-22

### Added

- Dedicated environment and collection-variable manager with direct Postman environment-file import.
- Safe cURL command import that fills method, URL, query parameters, headers, basic or bearer authentication, and request body without executing the command.
- Direct Add request controls on collections and Delete controls on request rows in the left tree.

### Fixed

- Postman environment values now respect the source file's `enabled` field.
- Structured Postman query parameters are no longer duplicated in the request URL and query editor.
- Imported collection variables are now visible and editable in the desktop application.

### Changed

- Increased interface typography and contrast throughout the workspace.
- Lifted the sidebar, editor, response, and code surfaces to lighter Postman-like neutral backgrounds.

## [1.2.0] - 2026-07-22

### Added

- Portable workspace export and import for sharing all collections and environments in a single `.apiqa-workspace` file.
- Automatic removal of token, secret, password, and API-key environment values from shared workspaces.
- Single-request Send execution with an inline response viewer.
- Recursive Postman folder navigation and request breadcrumbs.
- Request documentation, tests, and settings tabs alongside parameters, authorization, headers, and bodies.

### Changed

- Refined the desktop workspace to closely match Postman's dense three-pane layout.
- Moved request Save and Delete controls into the request breadcrumb toolbar.

## [1.1.0] - 2026-07-22

### Added

- Postman-style three-pane request workspace with collections and endpoints on the left, a persistent request editor in the center, and live copyable cURL on the right.
- Inline editing for HTTP method, URL, query parameters, headers, authorization, and request bodies.
- Confirmed endpoint deletion that preserves existing response history until normal retention cleanup.

### Changed

- Imported endpoints now open directly from the collection tree instead of in a modal editor.
- Request cURL snippets reflow with the available panel width for consistent layouts across desktop platforms.

## [1.0.4] - 2026-07-22

### Fixed

- Windows release packaging now targets the NSIS setup executable directly, avoiding a post-package failure from optional bundle formats.

## [1.0.3] - 2026-07-22

### Fixed

- Linux release packaging now targets the native Debian installer directly, bypassing an AppImage helper crash on GitHub's Ubuntu runner.

## [1.0.2] - 2026-07-22

### Fixed

- Disabled release-time LTO after LLVM aborted on the hosted Linux packaging runner; normal optimized compilation remains enabled.

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
