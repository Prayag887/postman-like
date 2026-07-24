# Proxy setup

1. Select an authorized Android device and application.
2. Generate the local CA if the UI reports `certificate required`.
3. Install the exported public certificate on the device.
4. Review the proposed host and port, then explicitly configure the Android proxy.
5. Start capture and navigate the app manually.
6. Stop capture to flush state and clear proxy configuration.

The app never silently changes Android proxy settings. Emulator traffic normally reaches the host at `10.0.2.2`; physical devices need the host LAN address.

If no traffic appears, do not assume no request occurred. Verify proxy configuration, certificate trust, app network-security configuration, pinning, QUIC/HTTP/3 bypass, and direct connections.

## Connect through QR

Choose **Connect via QR**, then on an Android 11 or newer device:

1. Enable Developer options and Wireless debugging.
2. Open **Pair device with QR code** inside Wireless debugging.
3. Scan the displayed code while both devices are on the same Wi-Fi network.

The Rust backend generates an expiring `WIFI:T:ADB` challenge, waits for the matching `_adb-tls-pairing._tcp` mDNS service, and completes pairing with the local ADB installation. The password is short-lived and is not persisted.

Use Android's Wireless debugging scanner. A normal camera or generic QR reader can decode the standard payload but cannot authorize ADB pairing by itself.
