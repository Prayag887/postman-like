# Missing Android API hits investigation

## Symptom

The App Tester proxy displayed only a subset of traffic after the CA was installed.

## Root cause

The connected target app, `com.yajtech.eynorixdev` (target SDK 36), does not trust
user-installed certificate authorities. The proxy records the initial `CONNECT` tunnel,
but Android aborts the TLS handshake before the inner HTTPS request can be forwarded and
captured. Device logcat contains `CertPathValidatorException: Trust anchor for
certification path not found` for both the app WebSocket and Firebase logging traffic.

This is expected on Android 7+ for apps that do not opt in to user CAs. Certificate
pinning or a custom TLS stack can also prevent decryption even after that opt-in.

## Evidence

- Device global proxy: `10.0.2.2:8080`.
- Inspector database contained three HTTPS `CONNECT` records, but no corresponding inner
  requests for the app endpoints.
- `adb logcat` reported the trust-anchor validation error immediately after the connection
  attempts.

## Required remedy

For a QA/debug build, the target Android app must include a Network Security Config that
trusts both system and user certificate stores. This repository contains the inspector,
not the target app source, so the app-side configuration cannot be applied here.

## Status

BLOCKED: requires authorization/source access for the target Android app, or a debug APK
built with the required QA trust configuration. Once provided, add the configuration,
rebuild/install the debug APK, and re-run capture. Verify separately whether the app uses
certificate pinning or non-proxy traffic such as QUIC.
