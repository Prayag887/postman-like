# Android certificate setup

App Tester generates an installation-local CA in its application data directory. The key file is restricted to the local user on Unix. Only the public PEM certificate should be installed on Android.

Use **HTTPS setup** in App Tester to generate the CA, copy its public certificate to the selected device's Downloads folder, and open Android's credential installer. Select **CA certificate**, choose `AppTester-HTTPS-CA.pem`, and approve Android's warning. This is the only manual action: Android deliberately prevents normal desktop tools from silently adding a trusted user CA.

Recent Android applications do not necessarily trust user-installed CAs. Debug builds may opt in using Android network security configuration. Certificate-pinned applications will reject interception unless the developer supplies a pinning-disabled debug build.

CA regeneration changes the fingerprint and requires reinstalling the public certificate. Never share or commit the private key.
