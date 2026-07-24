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
  skipped_branches: number;
  stop_reason: string;
}

export interface ModelDecision {
  engine: string;
  available: boolean;
  cached?: boolean;
  screen_type?: string;
  purpose?: string;
  preferred_action_label?: string | null;
  reason: string;
  latency_ms?: number;
}

export interface ScanIssue {
  category: string;
  severity: string;
  title: string;
  screen_name?: string;
  occurred_at?: string;
  evidence?: Record<string, unknown>;
}

export type ScanEvent =
  | {
      kind: "model_decision";
      occurred_at: string;
      state_id: string;
      screen: string;
      decision: ModelDecision;
    }
  | {
      kind: "incident";
      occurred_at: string;
      issue: ScanIssue;
    }
  | {
      kind: "transition";
      occurred_at: string;
      states: number;
      transitions: number;
      frontier: number;
      mode: string;
      screen: string;
      action: string;
      latency_ms: number;
    };
