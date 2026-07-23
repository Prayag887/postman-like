import { invoke } from "@tauri-apps/api/core";
import type { AndroidDevice } from "./types";

export async function discoverDevices(): Promise<AndroidDevice[]> {
  if (!("__TAURI_INTERNALS__" in window)) return [];
  return invoke("discover_devices");
}
