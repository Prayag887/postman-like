export type ConnectionType = "usb" | "wireless" | "emulator";
export type AuthorizationStatus =
  | "authorized"
  | "unauthorized"
  | "offline"
  | "unknown";

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
