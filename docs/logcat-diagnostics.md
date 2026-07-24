# Logcat diagnostics

Diagnostics are deterministic Rust parsers for crashes, ANRs, DTO/serialization failures, StrictMode violations, database errors, WebView failures, Flutter errors, React Native errors, jank, and network failures.

Only focused excerpts and application-owned frames belong in the UI. Signatures normalize dynamic identifiers so repeated incidents can increment one occurrence count.

Correlation uses transaction timing, target process, endpoint mentions, application frames, foreground activity, and interaction windows. Low-confidence matches are not attached prominently.

The current core includes parser and correlation primitives. Managed PID-aware logcat child-process supervision remains a hardening item.
