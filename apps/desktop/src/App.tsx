import { useCallback, useEffect, useState } from "react";
import {
  Cable,
  CircleHelp,
  Moon,
  MonitorSmartphone,
  RefreshCw,
  Smartphone,
  Sun,
  Wifi,
} from "lucide-react";
import { discoverDevices } from "./api";
import type { AndroidDevice, ConnectionType } from "./types";

const connectionIcon: Record<ConnectionType, typeof Cable> = {
  usb: Cable,
  wireless: Wifi,
  emulator: MonitorSmartphone,
};

export function platformLabel(device: AndroidDevice): string {
  if (!device.android_version) return "Android version unavailable";
  return `Android ${device.android_version}${
    device.api_level ? ` · API ${device.api_level}` : ""
  }`;
}

type Theme = "light" | "dark";

export function resolveInitialTheme(
  storedTheme: string | null,
  prefersDark: boolean,
): Theme {
  if (storedTheme === "light" || storedTheme === "dark") return storedTheme;
  return prefersDark ? "dark" : "light";
}

export function App() {
  const [devices, setDevices] = useState<AndroidDevice[]>([]);
  const [selected, setSelected] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [theme, setTheme] = useState<Theme>(() =>
    resolveInitialTheme(
      localStorage.getItem("app-tester-theme"),
      window.matchMedia("(prefers-color-scheme: dark)").matches,
    ),
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem("app-tester-theme", theme);
  }, [theme]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const next = await discoverDevices();
      setDevices(next);
      setSelected((current) =>
        next.some((device) => device.serial === current)
          ? current
          : next.find(
              (device) => device.authorization_status === "authorized",
            )?.serial,
      );
    } catch (reason) {
      setError(String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="app-shell">
      <aside>
        <div className="brand">
          <span className="brand-mark">
            <Smartphone aria-hidden="true" />
          </span>
          <div>
            <strong>App Tester</strong>
            <small>Autonomous Android QA</small>
          </div>
          <button
            className="theme-toggle"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            onClick={() =>
              setTheme((current) => (current === "dark" ? "light" : "dark"))
            }
          >
            {theme === "dark" ? (
              <Sun aria-hidden="true" />
            ) : (
              <Moon aria-hidden="true" />
            )}
          </button>
        </div>
        <nav aria-label="Workflow">
          <button className="active">
            <span>1</span> Device
          </button>
          <button disabled>
            <span>2</span> Application
          </button>
          <button disabled>
            <span>3</span> Live scan
          </button>
          <button disabled>
            <span>4</span> Results
          </button>
        </nav>
        <p className="privacy">Local-only. No telemetry. Your app data stays here.</p>
      </aside>

      <main>
        <header>
          <div>
            <p className="eyebrow">SETUP · DEVICE</p>
            <h1>Choose an Android device</h1>
            <p className="subtitle">
              Connect over USB, use a running emulator, or pair securely over
              Wi-Fi.
            </p>
          </div>
          <button className="secondary" onClick={() => void refresh()}>
            <RefreshCw className={loading ? "spin" : ""} aria-hidden="true" />
            Refresh
          </button>
        </header>

        <section className="pair-card">
          <div className="pair-icon">
            <Wifi aria-hidden="true" />
          </div>
          <div>
            <h2>Pair wirelessly</h2>
            <p>
              Android 11+ · Developer options → Wireless debugging → Pair device
              with QR code
            </p>
          </div>
          <button disabled title="QR pairing is the next implementation slice">
            Show pairing QR
          </button>
        </section>

        <div className="section-title">
          <h2>Available devices</h2>
          <span>{devices.length}</span>
        </div>

        {error && (
          <div className="error" role="alert">
            <CircleHelp aria-hidden="true" />
            <div>
              <strong>Device discovery failed</strong>
              <p>{error}</p>
            </div>
          </div>
        )}

        {!error && !loading && devices.length === 0 && (
          <div className="empty">
            <Smartphone aria-hidden="true" />
            <h3>No Android devices found</h3>
            <p>
              Connect a phone with USB debugging enabled or start an Android
              Studio emulator, then refresh.
            </p>
          </div>
        )}

        <div className="device-grid" role="radiogroup" aria-label="Devices">
          {devices.map((device) => {
            const Icon = connectionIcon[device.connection_type];
            const isSelected = selected === device.serial;
            const disabled = device.authorization_status !== "authorized";
            return (
              <button
                className={`device-card ${isSelected ? "selected" : ""}`}
                key={device.serial}
                role="radio"
                aria-checked={isSelected}
                disabled={disabled}
                onClick={() => setSelected(device.serial)}
              >
                <Icon aria-hidden="true" />
                <div>
                  <h3>{device.model ?? device.serial}</h3>
                  <p>{device.serial}</p>
                  <div className="metadata">
                    <span>{device.connection_type}</span>
                    {device.android_version && (
                      <span>{platformLabel(device)}</span>
                    )}
                    {device.resolution && <span>{device.resolution}</span>}
                    {device.architecture && <span>{device.architecture}</span>}
                  </div>
                </div>
                <span className={`status ${device.authorization_status}`}>
                  {device.authorization_status}
                </span>
              </button>
            );
          })}
        </div>

        <footer>
          <p>
            {selected
              ? "Device ready. Application selection is next."
              : "Select an authorized device to continue."}
          </p>
          <button disabled={!selected}>Continue</button>
        </footer>
      </main>
    </div>
  );
}
