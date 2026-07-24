import { describe, expect, it } from "vitest";
import {
  appendUniqueScanLog,
  nextStepForDevice,
  parseScanMetrics,
  platformLabel,
  resolveInitialTheme,
} from "./App";
import type { AndroidDevice, ScanSummary } from "./types";

const device: AndroidDevice = {
  serial: "emulator-5554",
  connection_type: "emulator",
  authorization_status: "authorized",
};

describe("device platform label", () => {
  it("shows Android and API versions when both are known", () => {
    expect(
      platformLabel({ ...device, android_version: "15", api_level: 35 }),
    ).toBe("Android 15 · API 35");
  });

  it("has an explicit fallback when metadata is unavailable", () => {
    expect(platformLabel(device)).toBe("Android version unavailable");
  });
});

describe("theme preference", () => {
  it("restores an explicit preference", () => {
    expect(resolveInitialTheme("light", true)).toBe("light");
    expect(resolveInitialTheme("dark", false)).toBe("dark");
  });

  it("uses the system theme when no preference was saved", () => {
    expect(resolveInitialTheme(null, true)).toBe("dark");
    expect(resolveInitialTheme(null, false)).toBe("light");
  });
});

describe("device workflow navigation", () => {
  it("advances to application selection after a device is selected", () => {
    expect(nextStepForDevice("emulator-5554")).toBe("application");
  });

  it("stays on device selection without a selected device", () => {
    expect(nextStepForDevice(undefined)).toBe("device");
  });
});

describe("live scan metrics", () => {
  it("uses the most recent scanner progress line", () => {
    expect(
      parseScanMetrics([
        "states=2 transitions=1 frontier=4",
        "model loaded",
        "states=6 transitions=5 frontier=54",
      ]),
    ).toEqual({ states: 6, transitions: 5, frontier: 54 });
  });

  it("prefers the final summary over streamed progress", () => {
    const summary: ScanSummary = {
      states_discovered: 8,
      actions_executed: 7,
      frontier_remaining: 13,
      complete: false,
      issues: 2,
      equivalent_actions_skipped: 97,
      skipped_branches: 3,
      stop_reason: "unreachable_branches",
    };
    expect(
      parseScanMetrics(["states=6 transitions=5 frontier=54"], summary),
    ).toEqual({ states: 8, transitions: 7, frontier: 13 });
  });
});

describe("live scan console", () => {
  it("ignores identical consecutive progress events", () => {
    const current = ["states=2 transitions=1 frontier=28"];
    expect(appendUniqueScanLog(current, current[0])).toBe(current);
  });

  it("keeps a new progress event", () => {
    expect(appendUniqueScanLog(["states=2"], "states=3")).toEqual([
      "states=2",
      "states=3",
    ]);
  });
});
