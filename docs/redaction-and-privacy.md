# Redaction and privacy

Rust redacts authorization, proxy authorization, cookies, API keys, auth/access/refresh tokens, passwords, passcodes, secrets, sessions, OTPs, PINs, private keys, and client secrets before persistence and UI events.

Generated cURL is redacted and excludes connection-level headers by default. Raw secret storage is not enabled.

The CA private key stays local, uses restrictive Unix permissions, is never logged, and is excluded from exports.
