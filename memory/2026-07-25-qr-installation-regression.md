# QR installation regression

- Symptom: `/Applications/App Tester.app` displayed the retired autonomous setup UI, including a disabled “Coming soon” QR button, after the QR pairing feature had been built and installed.
- Root cause: `apps/desktop/src-tauri/build.rs` did not declare `../dist` as a Cargo build dependency. Cargo could reuse a release executable that embedded old Tauri frontend assets after Vite produced new assets.
- Fix: emit `cargo:rerun-if-changed=../dist` before calling `tauri_build::build()`.
- Verification: a fresh `tauri build --bundles app` recompiled the Tauri crate; the replacement `/Applications/App Tester.app` accessibility tree contains `Connect via QR` and the Android Inspector layout.
