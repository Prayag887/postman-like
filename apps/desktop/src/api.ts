import { invoke } from "@tauri-apps/api/core";
import type { AndroidApp, AndroidDevice } from "./types";

export async function discoverDevices(): Promise<AndroidDevice[]> {
  if (!("__TAURI_INTERNALS__" in window)) {
    throw new Error(
      "Device discovery requires the native App Tester window. This browser preview is for interface development only.",
    );
  }
  return invoke("discover_devices");
}

export async function listInstalledApps(serial: string): Promise<AndroidApp[]> {
  if (!("__TAURI_INTERNALS__" in window)) {
    throw new Error(
      "Application discovery requires the native App Tester window.",
    );
  }
  return invoke("list_installed_apps", { serial });
}

export async function launchInstalledApp(
  serial: string,
  packageName: string,
): Promise<void> {
  return invoke("launch_installed_app", { serial, packageName });
}
