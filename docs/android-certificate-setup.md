# Android certificate setup

App Tester generates an installation-local CA in its application data directory. The key file is restricted to the local user on Unix. Only the public PEM certificate should be installed on Android.

Recent Android applications do not necessarily trust user-installed CAs. Debug builds may opt in using Android network security configuration. Certificate-pinned applications will reject interception unless the developer supplies a pinning-disabled debug build.

CA regeneration changes the fingerprint and requires reinstalling the public certificate. Never share or commit the private key.
