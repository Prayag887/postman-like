import { describe, expect, it } from "vitest";
import { platformLabel, resolveInitialTheme } from "./App";
import type { AndroidDevice } from "./types";

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
