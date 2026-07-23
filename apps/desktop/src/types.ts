export type ConnectionType = "usb" | "wireless" | "emulator";
export type AuthorizationStatus =
  "authorized" | "unauthorized" | "offline" | "unknown";

export interface AndroidDevice {
  serial: string;
  connection_type: ConnectionType;
  authorization_status: AuthorizationStatus;
  model?: string;
  android_version?: string;
  api_level?: number;
  resolution?: string;
  density?: number;
  architecture?: string;
  product?: string;
}

export interface AndroidApp {
  package_name: string;
  version_name?: string;
  version_code?: number;
}

export interface ScanSummary {
  states_discovered: number;
  actions_executed: number;
  frontier_remaining: number;
  complete: boolean;
  issues: number;
  equivalent_actions_skipped: number;
}
