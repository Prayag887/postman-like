export type ProxyStatus = "stopped" | "starting" | "running" | "certificate_required" |
  "device_not_configured" | "partially_available" | "blocked_by_pinning" | "failed";
export interface HeaderEntry { name: string; value: string }
export interface QueryParameter { name: string; value: string }
export type BodyStorage =
  | { storage: "empty" }
  | { storage: "inline"; bytes: number[] }
  | { storage: "artifact"; artifact_id: string; preview: number[]; original_size: number }
  | { storage: "truncated"; preview: number[]; original_size?: number }
  | { storage: "unavailable"; reason: string };
export interface CapturedRequest {
  method: string; scheme: string; host: string; port?: number; path: string;
  query: QueryParameter[]; headers: HeaderEntry[]; body: BodyStorage;
  content_type?: string; http_version: string;
}
export interface CapturedResponse {
  status: number; reason?: string; headers: HeaderEntry[]; body: BodyStorage;
  content_type?: string; decoded_size: number; encoded_size: number; http_version: string;
}
export interface Difference {
  kind: string; path?: string; previous?: string; current?: string;
  severity: "critical" | "warning" | "informational"; ignored: boolean; explanation: string;
}
export interface HttpTransaction {
  id: string; session_id: string; state: string; request: CapturedRequest;
  response?: CapturedResponse; timing: {
    request_started_ms: number; request_complete_ms?: number;
    response_started_ms?: number; response_complete_ms?: number;
  };
  endpoint_identity?: { method: string; host: string; path_template: string };
  curl?: { compact: string; multiline: string; redacted: boolean };
  capture_quality: string;
  comparison?: { compatibility: string; differences: Difference[] };
  correlated_incidents: string[]; created_at: string; updated_at: string;
}
export interface AndroidDevice {
  serial: string; connection_type: "usb" | "wireless" | "emulator";
  authorization_status: "authorized" | "unauthorized" | "offline" | "unknown";
  model?: string; android_version?: string; api_level?: number;
}
export interface AndroidApp { package_name: string; version_name?: string; version_code?: number }
export interface QrPairingChallenge {
  id: string; service_name: string; qr_payload: string; qr_svg: string; expires_at: string;
}
export interface QrPairingResult { endpoint: string; adb_output: string }
export interface AndroidCertificateInstall { remote_path: string; installer_output: string }
