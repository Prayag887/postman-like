import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowLeft,
  AppWindow,
  Cable,
  CircleHelp,
  Moon,
  MonitorSmartphone,
  RefreshCw,
  Search,
  Smartphone,
  Sun,
  Wifi,
} from "lucide-react";
import {
  discoverDevices,
  launchInstalledApp,
  listInstalledApps,
  runAutonomousScan,
} from "./api";
import type {
  AndroidApp,
  AndroidDevice,
  ConnectionType,
  ScanSummary,
} from "./types";

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

export function nextStepForDevice(
  selectedSerial: string | undefined,
): "device" | "application" {
  return selectedSerial ? "application" : "device";
}

export function parseScanMetrics(
  logs: string[],
  summary?: ScanSummary,
): { states: number; transitions: number; frontier: number } {
  const latest = [...logs].reverse().find((line) => line.startsWith("states="));
  const match = latest?.match(/states=(\d+) transitions=(\d+) frontier=(\d+)/);
  return {
    states: summary?.states_discovered ?? Number(match?.[1] ?? 0),
    transitions: summary?.actions_executed ?? Number(match?.[2] ?? 0),
    frontier: summary?.frontier_remaining ?? Number(match?.[3] ?? 0),
  };
}

export function appendUniqueScanLog(current: string[], next: string): string[] {
  return current.at(-1) === next ? current : [...current.slice(-99), next];
}

export function App() {
  const [step, setStep] = useState<"device" | "application" | "live">("device");
  const [devices, setDevices] = useState<AndroidDevice[]>([]);
  const [selected, setSelected] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [apps, setApps] = useState<AndroidApp[]>([]);
  const [selectedApp, setSelectedApp] = useState<string>();
  const [appSearch, setAppSearch] = useState("");
  const [appsLoading, setAppsLoading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [appLaunched, setAppLaunched] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanLogs, setScanLogs] = useState<string[]>([]);
  const [scanSummary, setScanSummary] = useState<ScanSummary>();
  const [scanOutput, setScanOutput] = useState<string>();
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
          : next.find((device) => device.authorization_status === "authorized")
              ?.serial,
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

  const filteredApps = useMemo(() => {
    const query = appSearch.trim().toLowerCase();
    if (!query) return apps;
    return apps.filter((app) => app.package_name.toLowerCase().includes(query));
  }, [appSearch, apps]);

  async function continueToApplications() {
    if (!selected) return;
    setStep(nextStepForDevice(selected));
    setAppsLoading(true);
    setError(undefined);
    try {
      const next = await listInstalledApps(selected);
      setApps(next);
      setSelectedApp((current) =>
        next.some((app) => app.package_name === current)
          ? current
          : next[0]?.package_name,
      );
    } catch (reason) {
      setError(String(reason));
    } finally {
      setAppsLoading(false);
    }
  }

  async function launchSelectedApplication() {
    if (!selected || !selectedApp) return;
    setLaunching(true);
    setError(undefined);
    try {
      await launchInstalledApp(selected, selectedApp);
      setAppLaunched(true);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setLaunching(false);
    }
  }

  async function startSafeScan() {
    if (!selected || !selectedApp) return;
    setStep("live");
    setScanning(true);
    setScanLogs([]);
    setScanSummary(undefined);
    setScanOutput(undefined);
    setError(undefined);
    const stopProgress = await listen<string>("scan-progress", (event) => {
      setScanLogs((current) => appendUniqueScanLog(current, event.payload));
    });
    const stopCompleted = await listen<string>("scan-completed", (event) => {
      setScanOutput(event.payload);
    });
    try {
      setScanSummary(await runAutonomousScan(selected, selectedApp));
    } catch (reason) {
      setError(String(reason));
    } finally {
      stopProgress();
      stopCompleted();
      setScanning(false);
    }
  }

  const liveMetrics = useMemo(
    () => parseScanMetrics(scanLogs, scanSummary),
    [scanLogs, scanSummary],
  );

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
          <button
            className={step === "device" ? "active" : ""}
            aria-current={step === "device" ? "step" : undefined}
            onClick={() => setStep("device")}
          >
            <span>1</span> Device
          </button>
          <button
            className={step === "application" ? "active" : ""}
            aria-current={step === "application" ? "step" : undefined}
            disabled={!selected}
            onClick={() => void continueToApplications()}
          >
            <span>2</span> Application
          </button>
          <button
            className={step === "live" ? "active" : ""}
            aria-current={step === "live" ? "step" : undefined}
            disabled={!appLaunched}
            onClick={() => setStep("live")}
          >
            <span>3</span> Live scan
          </button>
          <button disabled>
            <span>4</span> Results
          </button>
        </nav>
        <p className="privacy">
          Local-only. No telemetry. Your app data stays here.
        </p>
      </aside>

      {step === "device" ? (
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
                Android 11+ · Developer options → Wireless debugging → Pair
                device with QR code
              </p>
            </div>
            <button disabled title="QR pairing is not implemented yet">
              Coming soon
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
                      {device.architecture && (
                        <span>{device.architecture}</span>
                      )}
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
                ? "Device ready. Continue to choose an application."
                : "Select an authorized device to continue."}
            </p>
            <button
              disabled={!selected}
              onClick={() => void continueToApplications()}
            >
              Continue
            </button>
          </footer>
        </main>
      ) : step === "application" ? (
        <main>
          <header>
            <div>
              <p className="eyebrow">SETUP · APPLICATION</p>
              <h1>Choose an application</h1>
              <p className="subtitle">
                Select a third-party application installed on{" "}
                {devices.find((device) => device.serial === selected)?.model ??
                  selected}
                .
              </p>
            </div>
            <button className="secondary" onClick={() => setStep("device")}>
              <ArrowLeft aria-hidden="true" />
              Back
            </button>
          </header>

          <label className="search-field">
            <Search aria-hidden="true" />
            <span>Search installed applications</span>
            <input
              type="search"
              value={appSearch}
              onChange={(event) => setAppSearch(event.target.value)}
              placeholder="Package name"
            />
          </label>

          <div className="section-title">
            <h2>Installed applications</h2>
            <span>{filteredApps.length}</span>
          </div>

          {error && (
            <div className="error" role="alert">
              <CircleHelp aria-hidden="true" />
              <div>
                <strong>Application action failed</strong>
                <p>{error}</p>
              </div>
            </div>
          )}

          {!error && !appsLoading && apps.length === 0 && (
            <div className="empty">
              <AppWindow aria-hidden="true" />
              <h3>No third-party applications found</h3>
              <p>
                Install an application on the selected device, then go back and
                try again.
              </p>
            </div>
          )}

          {appsLoading ? (
            <div className="loading-state" role="status">
              <RefreshCw className="spin" aria-hidden="true" />
              Reading installed applications…
            </div>
          ) : (
            <div
              className="app-list"
              role="radiogroup"
              aria-label="Installed applications"
            >
              {filteredApps.map((app) => (
                <button
                  className={`app-row ${selectedApp === app.package_name ? "selected" : ""}`}
                  key={app.package_name}
                  role="radio"
                  aria-checked={selectedApp === app.package_name}
                  onClick={() => setSelectedApp(app.package_name)}
                >
                  <AppWindow aria-hidden="true" />
                  <span>
                    <strong>{app.package_name}</strong>
                    <small>
                      {app.version_name
                        ? `Version ${app.version_name}${app.version_code ? ` (${app.version_code})` : ""}`
                        : "Version unavailable"}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          )}

          <footer>
            <p>
              {selectedApp
                ? "Launch the app, complete login manually, then return here."
                : "Select an application to continue."}
            </p>
            <div className="footer-actions">
              <button
                className="secondary"
                disabled={!selectedApp || launching}
                onClick={() => void launchSelectedApplication()}
              >
                {launching ? "Launching…" : "Launch application"}
              </button>
              <button
                disabled={!appLaunched}
                onClick={() => void startSafeScan()}
              >
                Start safe scan
              </button>
            </div>
          </footer>
        </main>
      ) : (
        <main>
          <header>
            <div>
              <p className="eyebrow">AUTONOMOUS QA · LIVE SCAN</p>
              <h1>
                {scanning
                  ? "Exploring application"
                  : scanSummary
                    ? "Scan results"
                    : "Ready to explore"}
              </h1>
              <p className="subtitle">
                Qwen3-0.6B ranks deterministic safe actions. Every branch is
                restored and replayed before execution.
              </p>
            </div>
            <button
              className="secondary"
              disabled={scanning}
              onClick={() => setStep("application")}
            >
              <ArrowLeft aria-hidden="true" />
              Applications
            </button>
          </header>

          <section className="metrics" aria-label="Scan metrics">
            <div>
              <strong>{liveMetrics.states}</strong>
              <span>States</span>
            </div>
            <div>
              <strong>{liveMetrics.transitions}</strong>
              <span>Transitions</span>
            </div>
            <div>
              <strong>{liveMetrics.frontier}</strong>
              <span>Frontier</span>
            </div>
            <div>
              <strong>{scanSummary?.issues ?? 0}</strong>
              <span>Issues</span>
            </div>
          </section>

          {error && (
            <div className="error" role="alert">
              <CircleHelp aria-hidden="true" />
              <div>
                <strong>Scan failed</strong>
                <p>{error}</p>
              </div>
            </div>
          )}

          <section className="scan-console" aria-live="polite">
            <div className="scan-console-title">
              <span className={scanning ? "pulse-dot" : "complete-dot"} />
              {scanning
                ? "Local scanner running"
                : scanSummary
                  ? "Local scanner finished"
                  : "Local scanner ready"}
            </div>
            <pre>
              {scanLogs.length
                ? scanLogs.join("\n")
                : "Start a scan when the application is ready."}
            </pre>
          </section>

          {scanSummary && (
            <section className="scan-result">
              <h2>
                {scanSummary.complete
                  ? "Safe frontier exhausted"
                  : "Completed with configured limits"}
              </h2>
              <p>
                {scanSummary.issues} issues recorded.{" "}
                {scanSummary.frontier_remaining} frontier actions remain.{" "}
                {scanSummary.equivalent_actions_skipped} equivalent repeated
                actions were skipped.
              </p>
              {scanOutput && scanSummary.issues > 0 && (
                <code>{scanOutput}/agent_report.md</code>
              )}
            </section>
          )}

          <footer>
            <p>
              Scan evidence stays local and may contain private application
              content.
            </p>
            <button disabled={scanning} onClick={() => void startSafeScan()}>
              {scanSummary ? "Run another scan" : "Start safe scan"}
            </button>
          </footer>
        </main>
      )}
    </div>
  );
}
