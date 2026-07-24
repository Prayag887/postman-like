# App Tester

App Tester is a local-first Android traffic and runtime inspector. A developer navigates an Android app manually while the Rust backend captures HTTP traffic, compares compatible responses, watches actionable logcat incidents, and streams incremental updates to a Tauri desktop UI.

It does not tap, swipe, crawl screens, choose actions, or download AI models.

## Current architecture

- `crates/apiqa-core`: Android discovery, Hudsucker proxy, local CA, redaction, cURL generation, response comparison, diagnostics, correlation, SQLite, and typed events.
- `apps/desktop/src-tauri`: application lifecycle and explicit commands.
- `apps/desktop`: React view state and the live inspector.
- `apps/cli`: Rust-only device discovery utility.

Core capture and analysis runs in Rust. The UI displays state, filters traffic, requests actions, and copies already-redacted values.

Devices can connect through USB, an existing wireless ADB connection, or the **Connect via QR** flow. QR pairing uses Android's standard wireless-debugging payload and built-in pairing scanner on Android 11 and newer.

## Development

Requirements: Rust 1.86+, pnpm, Android Platform Tools, and a connected Android device or emulator.

```bash
pnpm install
cargo test --workspace
pnpm --dir apps/desktop check
pnpm --dir apps/desktop tauri dev
```

See [proxy setup](docs/proxy-setup.md), [Android certificate setup](docs/android-certificate-setup.md), and [known limitations](docs/known-limitations.md) before capturing HTTPS traffic.

## Privacy

Sensitive headers, query parameters, and JSON keys are redacted in Rust before persistence or frontend delivery. The local CA private key is never exported. See [redaction and privacy](docs/redaction-and-privacy.md).

## Status

This architectural rewrite establishes the Rust-native proxy and inspection foundation. Large-body artifact streaming, complete logcat process supervision, richer baseline selection, and production hardening remain tracked as limitations rather than being represented as complete.
