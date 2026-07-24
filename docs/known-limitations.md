# Known limitations

- User-installed CA trust depends on the target application's Android network-security policy.
- QR connection requires Android 11+, Wireless debugging, a recent Platform Tools installation, and a network that permits mDNS/multicast between the computer and device.
- Certificate pinning, QUIC/HTTP/3, and direct sockets can bypass interception.
- Body capture currently uses a bounded preview model; non-blocking content-addressed artifact streaming is not complete.
- HTTP/2 is enabled in Hudsucker, but device-level concurrency and WebSocket frame integration need broader testing.
- PID-aware logcat collection, foreground observation, gfxinfo, and meminfo supervision are not yet fully wired to the desktop lifecycle.
- Baseline persistence exists, while pinned session/version selection and rule editing need UI completion.
- Export/import and raw body export are not complete.

The UI should describe unavailable capture explicitly and must not interpret missing traffic as proof that no request occurred.
