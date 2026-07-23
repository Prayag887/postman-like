import { invoke } from "@tauri-apps/api/core";
import type { AndroidDevice } from "./types";

export async function discoverDevices(): Promise<AndroidDevice[]> {
  if (!("__TAURI_INTERNALS__" in window)) {
    throw new Error(
      "Device discovery requires the native App Tester window. This browser preview is for interface development only.",
    );
  }
  return invoke("discover_devices");
}
