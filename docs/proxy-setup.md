# Proxy setup

1. Select an authorized Android device and application.
2. Generate the local CA if the UI reports `certificate required`.
3. Install the exported public certificate on the device.
4. Review the proposed host and port, then explicitly configure the Android proxy.
5. Start capture and navigate the app manually.
6. Stop capture to flush state and clear proxy configuration.

The fastest route is **HTTPS setup**: it generates and transfers the local CA automatically, then opens Android's installer. Confirm the one Android security prompt and return to App Tester to start capture.

The app never silently changes Android proxy settings. Emulator traffic normally reaches the host at `10.0.2.2`; physical devices need the host LAN address.

If no traffic appears, do not assume no request occurred. Verify proxy configuration, certificate trust, app network-security configuration, pinning, QUIC/HTTP/3 bypass, and direct connections.

## Connect through QR

Choose **Connect via QR**, then on an Android 11 or newer device:

1. Enable Developer options and Wireless debugging.
2. Open **Pair device with QR code** inside Wireless debugging.
3. Scan the displayed code while both devices are on the same Wi-Fi network.

The Rust backend generates an expiring `WIFI:T:ADB` challenge, waits for the matching `_adb-tls-pairing._tcp` mDNS service, and completes pairing with the local ADB installation. The password is short-lived and is not persisted.

Use Android's Wireless debugging scanner. A normal camera or generic QR reader can decode the standard payload but cannot authorize ADB pairing by itself.

## Pair with a code

If Android's QR scanner stalls, choose **Pair with code** in App Tester instead. On the device, select **Pair device with pairing code** under Wireless debugging, then enter the device IP address, the temporary pairing port, and the displayed six-digit code. This uses the same secure ADB TLS pairing mechanism without the system QR scanner.

## USB to Wi-Fi

For a device already authorized for USB debugging, select it in App Tester and choose **USB to Wi-Fi**. App Tester enables legacy ADB over TCP/IP on port 5555, reads the Wi-Fi address from the device routing table, and connects to that endpoint. Keep both devices on the same network. This path is for development devices you control; reconnect by USB or disable USB debugging when you no longer want the wireless endpoint available.
