# Debug report: device Continue action

**Status:** DONE

## Symptom

After App Tester selected `emulator-5554`, clicking **Continue** produced no visible change.

## Root cause

The frontend had no workflow navigation state or Continue handler, and the Tauri backend exposed only device discovery. Application discovery and launching did not exist.

During verification, a second issue appeared: launching with Android's `monkey` command could choose LeakCanary's launcher activity when a debug package exposed multiple launcher activities.

## Fix

- Added device-to-application workflow navigation.
- Added third-party package discovery with version metadata.
- Added application search, selection, loading, empty, and error states.
- Added deterministic launcher-activity resolution.
- Added validated application launching through `am start -W`.
- Added browser-runtime errors instead of fake application results.

## Evidence

- Continue opened the Application screen on the packaged macOS build.
- The emulator returned two installed third-party applications.
- `com.yajtech.eynorixdev` launched into `com.dn.erplms.MainActivity`.
- The focused activity was not `leakcanary.internal.activity.LeakLauncherActivity`.
- Five Rust tests and six frontend tests passed.
- Strict clippy, TypeScript checking, and the production frontend build passed.

## Regression tests

- `crates/apiqa-core/src/lib.rs`: package parsing, unsafe package rejection, and multi-launcher selection.
- `apps/desktop/src/App.test.ts`: selected-device workflow navigation.
