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
- Safety-gated local semantic exploration with versioned state and transition evidence; an optional Qwen vertical slice remains available for offline experimentation.
- Session-aware depth-first navigation that never force-stops or relaunches the target application.
- A semantic action ledger that prevents tabs and ordinary controls from being re-tested when timers or list content create a new state fingerprint.
- Feature-fair scheduling that periodically rotates away from the current semantic screen instead of exhausting one feature first.
- Adaptive single-observation navigation and semantic/model caches that keep known screens off the expensive analysis path.
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

On Apple silicon, autonomous navigation uses the 6-bit MLX build of
`UI-Venus-1.5-2B`. The model is downloaded once (approximately 2.3 GB), kept
entirely local, and reused from the Hugging Face cache. Other platforms retain
the experimental `Qwen/Qwen3-0.6B` PyTorch scanner.

Install the local-only model dependencies:

```bash
python3.11 -m pip install -r scripts/requirements-local-model.txt
```

Launch and log into the Android application, then run a bounded safe scan:

```bash
python3 scripts/local_model_scan.py \
  --serial emulator-5554 \
  --package com.example.app \
  --steps 4
```

The scanner captures screenshots and UI hierarchies, fingerprints states,
discovers clickable actions, blocks deterministic high-risk language, validates
model output, and records every transition under `scan-results/`. UI-Venus is
asked once for each new ambiguous screen schema; its intent and representative
action are cached, so revisiting a known screen does not incur another
inference delay. Simple screens stay on the deterministic path. Scan results
are ignored by Git because they can contain private application data.

For graph-based exploration with in-session branch navigation, scrolling, checkpoint persistence, deterministic issue analysis, and an agent report:

```bash
python3 scripts/autonomous_scan.py \
  --serial emulator-5554 \
  --package com.example.app \
  --max-states 30 \
  --max-actions 100 \
  --max-minutes 15
```

Newly reached screens are explored in the existing app session. The scanner attaches to the application already open in the foreground. To reach another branch it uses only visible in-app Back, Close, or Navigate Up controls and semantic actions inside that same process. It never sends Android's system Back key. If a branch cannot be reached through visible controls without leaving the target application, it is skipped; the scanner never closes, force-stops, or relaunches the app. A fairness limit rotates the frontier after several consecutive actions on one semantic screen. Fast local semantics record a short screen name, purpose, flow stage, and confidence for every state.

The desktop UI streams planner decisions and actionable incidents while the
scan is running. Reports omit non-issues and retain concrete failure evidence,
including screen and action context plus captured network or runtime details
when available.

Target-process logcat is correlated with the action and screen active at the time. Recognized JSON/DTO parsing failures include the parser/DTO name, redacted curl, redacted response evidence, timestamp, screen, and navigation path when those values were actually logged by the application. StrictMode reports include the screen, triggering action, navigation path, timestamp, and stack excerpt. Secrets in authorization, cookie, API-key, token, password, and session fields are redacted. Missing network evidence is explicitly reported rather than inferred.

The scan directory contains `checkpoint.json`, `graph.json`, `graph.mmd`, `transitions/transitions.jsonl`, `model-decisions.jsonl`, `issues.jsonl`, `coverage.json`, `sampling.json`, screenshots, UI hierarchies, and per-transition runtime logs. `agent_report.md` is added only when issues exist.

Repeated collections are sampled by semantic variant discovered contrastively from visible card context while navigating. The scanner derives stable collection and variant labels from differing structural fields, badges, status text, capabilities, and content shape; users do not configure names such as completed or upcoming. It tests one representative per discovered variant and action role and records equivalent skipped actions in `sampling.json`. Controls are considered effective when the scanner observes a UI hierarchy change, foreground activity change, network request, external navigation, or runtime incident.

For non-collection controls, tested identity is based on feature scope, semantic screen name, control role, and label rather than the raw state hash or bounds. A queued action may be retargeted to the current equivalent semantic screen, avoiding navigation back to an obsolete timer/list snapshot.

`agent_report.md` is created only when at least one issue exists. It contains issue packets—not general scan inventory—with the symptom, likely causes, reproduction path, evidence, and developer next steps. Issue-free runs have no `agent_report.md`; their non-issue coverage data remains in the machine-readable scan artifacts.

CLI limits are explicit. Passing `0` for state or action limits makes that dimension coverage-driven. Desktop scans use unlimited state/action counts and stop when the reachable safe frontier is exhausted, with a two-hour wall-clock safety guard. A run that stops with frontier entries remaining reports `complete: false`; it never claims full coverage merely because a safety limit was reached.

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
