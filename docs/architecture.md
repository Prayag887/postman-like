# Architecture

```text
Human navigation
  -> Android proxy
  -> lifecycle-managed Rust Hudsucker service
  -> redaction and typed transaction capture
  -> SQLite metadata / content-addressed artifacts
  -> compatibility and response comparison
  -> logcat diagnostics and correlation
  -> typed incremental Tauri events
  -> React inspector
```

`androidqa-core` owns all security-sensitive and analytical behavior. React owns only view state, filters, selection, and explicit commands.

Transactions are created when requests are captured and updated when responses complete. The event broadcaster sends incremental objects; history is loaded through paginated database queries.

The proxy has explicit stopped, starting, running, certificate-required, device-not-configured, partially-available, blocked-by-pinning, and failed states.
