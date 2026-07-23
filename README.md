# App Tester

App Tester is an open-source, local-first desktop application for autonomous Android QA. It is being built to explore an authenticated Android application safely, preserve evidence, and produce reproducible reports for coding agents.

> Early development release: autonomous scanning works, but coverage is bounded and reports are only as complete as the evidence exposed by the target application and Android.

## Implemented

- Native Tauri 2 desktop shell with a Rust backend and accessible React UI.
- Automatic discovery of USB devices, wireless ADB devices, and Android Studio emulators.
- Device authorization/offline status.
- Device model, Android version, API level, resolution, density, and CPU architecture.
- Android Platform Tools lookup through `APP_TESTER_ADB`, Android SDK environment variables, common SDK locations, and `PATH`.
- A small JSON CLI for diagnostics and automation.
- Safety-gated local-model exploration using Qwen3-0.6B, with versioned state and transition evidence.
- Session-aware depth-first navigation that never force-stops or relaunches the target application.
- A semantic action ledger that prevents tabs and ordinary controls from being re-tested when timers or list content create a new state fingerprint.
- Local-model discovery and representative sampling of repeated collection variants without user configuration or a fixed status taxonomy.
- Local semantic screen summaries and flow-stage classification.
- Redacted API/DTO parsing and Android StrictMode incident capture from target-process logcat.
- Observable-effect checks for every safe control, including arbitrary controls whose labels do not look navigational.
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

The scanner captures screenshots and UI hierarchies, fingerprints states, discovers clickable actions, blocks deterministic high-risk language, asks the local model only to rank remaining safe actions, validates its JSON response, and records every transition under `scan-results/`. Scan results are ignored by Git because they can contain private application data. After launching a selected application, the desktop Live Scan screen can start this local worker and stream its progress.

For graph-based exploration with in-session branch navigation, scrolling, checkpoint persistence, deterministic issue analysis, and an agent report:

```bash
python3 scripts/autonomous_scan.py \
  --serial emulator-5554 \
  --package com.example.app \
  --max-states 30 \
  --max-actions 100 \
  --max-minutes 15
```

Newly reached screens are explored depth-first in the existing app session. The scanner attaches to the application already open in the foreground. To reach another branch it uses the Android back stack and semantic actions inside that same process. If a branch cannot be reached without leaving the target application, it is skipped; the scanner never force-stops or relaunches the app. The local model records a short screen name, purpose, flow stage, and confidence for every state.

Target-process logcat is correlated with the action and screen active at the time. Recognized JSON/DTO parsing failures include the parser/DTO name, redacted curl, redacted response evidence, timestamp, screen, and navigation path when those values were actually logged by the application. StrictMode reports include the screen, triggering action, navigation path, timestamp, and stack excerpt. Secrets in authorization, cookie, API-key, token, password, and session fields are redacted. Missing network evidence is explicitly reported rather than inferred.

The scan directory contains `checkpoint.json`, `graph.json`, `graph.mmd`, `transitions/transitions.jsonl`, `model-decisions.jsonl`, `issues.jsonl`, `coverage.json`, `sampling.json`, screenshots, UI hierarchies, and per-transition runtime logs. `agent_report.md` is added only when issues exist.

Repeated collections are sampled by semantic variant discovered from the visible card context while navigating. The local model assigns stable collection and variant labels from badges, status text, capabilities, and content shape; users do not configure names such as completed or upcoming. The scanner tests one representative per discovered variant and action role and records equivalent skipped actions in `sampling.json`. Controls are considered effective when the scanner observes a UI hierarchy change, foreground activity change, network request, external navigation, or runtime incident.

For non-collection controls, tested identity is based on feature scope, semantic screen name, control role, and label rather than the raw state hash or bounds. A queued action may be retargeted to the current equivalent semantic screen, avoiding navigation back to an obsolete timer/list snapshot.

`agent_report.md` is created only when at least one issue exists. It contains issue packets—not general scan inventory—with the symptom, likely causes, reproduction path, evidence, and developer next steps. Issue-free runs have no `agent_report.md`; their non-issue coverage data remains in the machine-readable scan artifacts.

Limits are explicit. A run that stops with frontier entries remaining reports `complete: false`; it never claims full coverage merely because a configured limit was reached.

## Roadmap (not yet implemented)

- Secure Android 11+ wireless QR pairing and pairing-code fallback.
- APK file installation and manual login handoff guidance.
- Resume-from-checkpoint and explicit pause/cancel controls.
- Deterministic crash, ANR, loading, and form analyzers.
- Live visual graph rendering.
- Android fixture application and emulator integration tests.

Do not treat roadmap items as available functionality.

## Releases

Tags matching `v*` trigger native artifacts for macOS Apple Silicon, macOS Intel, Windows, and Linux. Community builds are unsigned until signing and notarization credentials are configured.

## License

MIT. See [SECURITY.md](SECURITY.md) for vulnerability reporting.
