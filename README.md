# App Tester

App Tester is an open-source, local-first desktop application for autonomous Android QA. It is being built to explore an authenticated Android application safely, preserve evidence, and produce reproducible reports for coding agents.

> Early development release: device discovery is working. Autonomous scanning and reports are not implemented yet.

## Implemented

- Native Tauri 2 desktop shell with a Rust backend and accessible React UI.
- Automatic discovery of USB devices, wireless ADB devices, and Android Studio emulators.
- Device authorization/offline status.
- Device model, Android version, API level, resolution, density, and CPU architecture.
- Android Platform Tools lookup through `APP_TESTER_ADB`, Android SDK environment variables, common SDK locations, and `PATH`.
- A small JSON CLI for diagnostics and automation.
- Safety-gated local-model exploration using Qwen3-0.6B, with versioned state and transition evidence.
- Unit tests for ADB output parsing and connection classification.
- macOS, Windows, and Linux CI; release packaging for macOS Apple Silicon/Intel, Windows, and Linux.

## Privacy

App Tester does not use a cloud account or telemetry. The current device-discovery flow invokes the local `adb` executable and does not upload device or application data.

## Connect a device

Install Android Platform Tools, or install Android Studio and its Android SDK.

- USB: enable Developer options and USB debugging, connect the phone, and accept its authorization prompt.
- Emulator: start an Android Studio emulator before opening App Tester.
- Previously paired wireless device: connect it with ADB; App Tester classifies `host:port` serials as wireless.

Android 11+ QR pairing and pairing-code fallback are part of the next product slice; the disabled UI control is intentionally labeled and does not claim to work.

## Development

Requirements: Rust 1.96+, Node 24+, pnpm 11+, Android Platform Tools, and the [Tauri 2 platform prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
pnpm install
pnpm --dir apps/desktop tauri dev
```

Run the complete current validation:

```bash
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all -- --check
pnpm --dir apps/desktop check
pnpm --dir apps/desktop build
```

List devices from the CLI:

```bash
cargo run -p app-tester
```

To use a specific ADB binary:

```bash
APP_TESTER_ADB=/absolute/path/to/adb cargo run -p app-tester
```

## Local-model scan

The first autonomous vertical slice uses the official `Qwen/Qwen3-0.6B` model through local PyTorch inference. The initial model download is approximately 1.4 GB on disk and is reused offline afterward.

Install the local-only model dependencies:

```bash
python3 -m pip install -r scripts/requirements-local-model.txt
```

Launch and log into the Android application, then run a bounded safe scan:

```bash
python3 scripts/local_model_scan.py \
  --serial emulator-5554 \
  --package com.example.app \
  --steps 4
```

The scanner captures screenshots and UI hierarchies, fingerprints states, discovers clickable actions, blocks deterministic high-risk language, asks the local model only to rank remaining safe actions, validates its JSON response, and records every transition under `scan-results/`. Scan results are ignored by Git because they can contain private application data.

This is currently a developer-facing vertical slice. Live progress and scan controls are not yet connected to the desktop Live Scan screen.

## Roadmap (not yet implemented)

- Secure Android 11+ wireless QR pairing and pairing-code fallback.
- Application/APK selection, launch, and manual login handoff.
- Persistent multi-pass state/action exploration beyond the current bounded local-model slice.
- UI hierarchy capture, screenshots, scrolling, replay, and recovery.
- Deterministic crash, ANR, navigation, loading, layout, accessibility, and form analyzers.
- Live graph and scan progress.
- Versioned scan bundles and `agent_report.md`.
- Optional tiny local model for constrained semantic classification.
- Android fixture application and emulator integration tests.

Do not treat roadmap items as available functionality.

## Releases

Tags matching `v*` trigger native artifacts for macOS Apple Silicon, macOS Intel, Windows, and Linux. Community builds are unsigned until signing and notarization credentials are configured.

## License

MIT. See [SECURITY.md](SECURITY.md) for vulnerability reporting.
