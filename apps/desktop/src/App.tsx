import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Check,
  ChevronRight,
  Clock3,
  Database,
  FileDiff,
  FolderOpen,
  History,
  Import,
  Play,
  Pin,
  Search,
  Settings,
} from "lucide-react";
import {
  importCollection,
  importEnvironment,
  listCollections,
  listEnvironments,
  listRuns,
  runCollection,
  setRunPinned,
} from "./api";
import type { Collection, Environment, Execution, Run } from "./types";

type View = "collections" | "history" | "regressions";

const methodClass = (method: string) => `method method-${method.toLowerCase()}`;

export function App() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [environmentId, setEnvironmentId] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [activeRun, setActiveRun] = useState<Run>();
  const [activeExecution, setActiveExecution] = useState<Execution>();
  const [view, setView] = useState<View>("collections");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);
  const environmentFileRef = useRef<HTMLInputElement>(null);

  const collection = collections.find((item) => item.id === selected);
  const collectionRuns = runs.filter((run) => run.collection_id === selected);

  async function refresh(preferred?: string) {
    const [nextCollections, nextRuns, nextEnvironments] = await Promise.all([
      listCollections(),
      listRuns(),
      listEnvironments(),
    ]);
    setCollections(nextCollections);
    setRuns(nextRuns);
    setEnvironments(nextEnvironments);
    setSelected(preferred ?? selected ?? nextCollections[0]?.id);
  }

  useEffect(() => {
    refresh().catch((reason) => setError(String(reason)));
  }, []);

  async function onImport(file?: File) {
    if (!file) return;
    setError(undefined);
    try {
      const imported = await importCollection(await file.text());
      await refresh(imported.id);
      setView("collections");
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function onRun() {
    if (!collection) return;
    setRunning(true);
    setError(undefined);
    setActiveExecution(undefined);
    try {
      const run = await runCollection(
        collection.id,
        collectionRuns[0]?.id,
        environmentId,
      );
      setActiveRun(run);
      setRuns((current) => [
        run,
        ...current.filter((item) => item.id !== run.id),
      ]);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setRunning(false);
    }
  }

  async function onEnvironmentImport(file?: File) {
    if (!file) return;
    try {
      const environment = await importEnvironment(await file.text());
      setEnvironments((current) => [
        environment,
        ...current.filter((item) => item.id !== environment.id),
      ]);
      setEnvironmentId(environment.id);
    } catch (reason) {
      setError(String(reason));
    }
  }

  const summary = useMemo(() => {
    const executions = activeRun?.executions ?? [];
    return {
      total: executions.length,
      passed: executions.filter((item) => item.state === "passed").length,
      changed: executions.filter((item) => item.state === "changed").length,
      failed: executions.filter((item) =>
        ["transport_failed", "assertion_failed"].includes(item.state),
      ).length,
    };
  }, [activeRun]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Activity size={18} />
          </div>
          <span>APIQA</span>
          <em>beta</em>
        </div>
        <nav>
          <Nav
            icon={<FolderOpen />}
            label="Collections"
            active={view === "collections"}
            onClick={() => setView("collections")}
          />
          <Nav
            icon={<History />}
            label="History"
            active={view === "history"}
            onClick={() => setView("history")}
          />
          <Nav
            icon={<FileDiff />}
            label="Regressions"
            active={view === "regressions"}
            onClick={() => setView("regressions")}
            badge={
              runs.filter((run) => run.state === "completed_with_findings")
                .length
            }
          />
        </nav>
        <div className="sidebar-section-label">COLLECTIONS</div>
        <div className="collection-list">
          {collections.map((item) => (
            <button
              key={item.id}
              className={`collection-item ${selected === item.id ? "active" : ""}`}
              onClick={() => {
                setSelected(item.id);
                setActiveRun(undefined);
                setActiveExecution(undefined);
              }}
            >
              <span className="collection-dot" />
              <span>{item.name}</span>
              <small>{item.requests.length}</small>
            </button>
          ))}
        </div>
        <button
          className="import-side"
          onClick={() => fileRef.current?.click()}
        >
          <Import size={16} /> Import Postman
        </button>
        <div className="sidebar-footer">
          <Settings size={16} />
          <span>Settings</span>
          <kbd>⌘,</kbd>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div className="crumb">
            <span>{labelFor(view)}</span>
            {collection && (
              <>
                <ChevronRight />
                <strong>{collection.name}</strong>
              </>
            )}
          </div>
          <div className="top-actions">
            <button className="icon-button" aria-label="Search">
              <Search />
            </button>
            <select
              className="environment"
              value={environmentId ?? ""}
              onChange={(event) => {
                if (event.target.value === "__import") {
                  environmentFileRef.current?.click();
                } else {
                  setEnvironmentId(event.target.value || undefined);
                }
              }}
              aria-label="Active environment"
            >
              <option value="">No environment</option>
              {environments.map((environment) => (
                <option key={environment.id} value={environment.id}>
                  {environment.name}
                </option>
              ))}
              <option value="__import">Import environment…</option>
            </select>
          </div>
        </header>

        {error && (
          <div className="error-banner">
            <AlertTriangle size={17} />
            {error}
            <button onClick={() => setError(undefined)}>Dismiss</button>
          </div>
        )}
        {!collections.length ? (
          <EmptyState onImport={() => fileRef.current?.click()} />
        ) : view === "collections" ? (
          <CollectionView
            collection={collection}
            runs={collectionRuns}
            activeRun={activeRun}
            running={running}
            summary={summary}
            onRun={onRun}
            onOpenRun={setActiveRun}
            activeExecution={activeExecution}
            onExecution={setActiveExecution}
          />
        ) : (
          <RunsView
            runs={
              view === "regressions"
                ? runs.filter((run) => run.state === "completed_with_findings")
                : runs
            }
            onOpen={(run) => {
              setSelected(run.collection_id);
              setActiveRun(run);
              setView("collections");
            }}
          />
        )}
      </main>
      <input
        ref={fileRef}
        type="file"
        hidden
        accept="application/json,.json"
        onChange={(event) => onImport(event.target.files?.[0])}
      />
      <input
        ref={environmentFileRef}
        type="file"
        hidden
        accept="application/json,.json"
        onChange={(event) => onEnvironmentImport(event.target.files?.[0])}
      />
    </div>
  );
}

function Nav({
  icon,
  label,
  active,
  onClick,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button className={active ? "active" : ""} onClick={onClick}>
      {icon}
      <span>{label}</span>
      {!!badge && <b>{badge}</b>}
    </button>
  );
}

function EmptyState({ onImport }: { onImport: () => void }) {
  return (
    <section className="empty-state">
      <div className="empty-visual">
        <div />
        <div />
        <Database />
      </div>
      <p className="eyebrow">YOUR API, OVER TIME</p>
      <h1>
        Catch response regressions
        <br />
        before your users do.
      </h1>
      <p>
        Import a Postman collection, run it, and APIQA will remember every
        response so you can see exactly what changed.
      </p>
      <button className="primary large" onClick={onImport}>
        <Import size={18} /> Import Postman collection
      </button>
      <small>Postman Collection v2.0 and v2.1 · Stored locally</small>
    </section>
  );
}

function CollectionView({
  collection,
  runs,
  activeRun,
  running,
  summary,
  onRun,
  onOpenRun,
  activeExecution,
  onExecution,
}: {
  collection?: Collection;
  runs: Run[];
  activeRun?: Run;
  running: boolean;
  summary: { total: number; passed: number; changed: number; failed: number };
  onRun: () => void;
  onOpenRun: (run: Run) => void;
  activeExecution?: Execution;
  onExecution: (execution: Execution) => void;
}) {
  if (!collection) return null;
  return (
    <div className="workspace">
      <section className="collection-head">
        <div>
          <p className="eyebrow">COLLECTION</p>
          <h1>{collection.name}</h1>
          <p>
            {collection.requests.length} endpoints · {runs.length} historical
            runs
          </p>
        </div>
        <button className="primary" disabled={running} onClick={onRun}>
          <Play size={17} fill="currentColor" />
          {running ? "Running…" : "Run collection"}
        </button>
      </section>
      {collection.import_warnings.length > 0 && (
        <div className="warning">
          <AlertTriangle size={17} />
          <span>
            {collection.import_warnings.length} import warning
            {collection.import_warnings.length === 1 ? "" : "s"}. Scripts are
            preserved as warnings in this version.
          </span>
        </div>
      )}
      {activeRun ? (
        <RunReport
          run={activeRun}
          summary={summary}
          active={activeExecution}
          onExecution={onExecution}
        />
      ) : (
        <div className="split">
          <section className="panel">
            <div className="panel-title">
              <h2>Endpoints</h2>
              <span>{collection.requests.length}</span>
            </div>
            {collection.requests.map((request) => (
              <div className="request-row" key={request.id}>
                <span className={methodClass(request.method)}>
                  {request.method}
                </span>
                <div>
                  <strong>{request.name}</strong>
                  <small>{request.url}</small>
                </div>
                <ChevronRight />
              </div>
            ))}
          </section>
          <section className="panel">
            <div className="panel-title">
              <h2>Recent runs</h2>
              <button>View all</button>
            </div>
            {runs.length ? (
              runs
                .slice(0, 6)
                .map((run) => (
                  <RunRow
                    key={run.id}
                    run={run}
                    onClick={() => onOpenRun(run)}
                  />
                ))
            ) : (
              <div className="mini-empty">
                <Clock3 />
                <strong>No history yet</strong>
                <p>
                  Your first run becomes the baseline for future comparisons.
                </p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function RunReport({
  run,
  summary,
  active,
  onExecution,
}: {
  run: Run;
  summary: { total: number; passed: number; changed: number; failed: number };
  active?: Execution;
  onExecution: (execution: Execution) => void;
}) {
  const [pinned, setPinned] = useState(run.pinned);
  async function togglePinned() {
    await setRunPinned(run.id, !pinned);
    setPinned(!pinned);
  }
  return (
    <>
      <div className="report-head">
        <div>
          <button className="back-label">RUN REPORT</button>
          <h2>{new Date(run.started_at).toLocaleString()}</h2>
          <p>
            Compared with{" "}
            {run.baseline_run_id
              ? "the selected baseline"
              : "no baseline (first run)"}
          </p>
        </div>
        <div className="report-actions">
          <button
            className={pinned ? "pin active" : "pin"}
            onClick={togglePinned}
            title="Pinned runs are never removed by retention cleanup"
          >
            <Pin size={13} />
            {pinned ? "Pinned" : "Pin baseline"}
          </button>
          <span className={`run-state ${run.state}`}>
            {run.state.replaceAll("_", " ")}
          </span>
        </div>
      </div>
      <div className="stats">
        <Stat label="Total" value={summary.total} />
        <Stat label="Unchanged" value={summary.passed} good />
        <Stat label="Changed" value={summary.changed} warn />
        <Stat label="Failed" value={summary.failed} bad />
      </div>
      <div className="report-grid">
        <section className="panel result-list">
          <div className="panel-title">
            <h2>Endpoint results</h2>
            <span>{run.executions.length}</span>
          </div>
          {run.executions.map((execution) => (
            <button
              key={execution.id}
              className={`result-row ${active?.id === execution.id ? "active" : ""}`}
              onClick={() => onExecution(execution)}
            >
              <StateIcon state={execution.state} />
              <div>
                <strong>{execution.request_name}</strong>
                <small>
                  {execution.response
                    ? `${execution.response.status} · ${execution.response.duration_ms} ms`
                    : execution.error}
                </small>
              </div>
              {execution.comparison?.differences.length ? (
                <b>{execution.comparison.differences.length}</b>
              ) : (
                <ChevronRight />
              )}
            </button>
          ))}
        </section>
        <section className="panel diff-panel">
          {active ? (
            <ExecutionDetail execution={active} />
          ) : (
            <div className="mini-empty">
              <FileDiff />
              <strong>Select an endpoint</strong>
              <p>Inspect its response and every detected change.</p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function ExecutionDetail({ execution }: { execution: Execution }) {
  return (
    <div className="execution-detail">
      <div className="panel-title">
        <div>
          <p className="eyebrow">RESPONSE</p>
          <h2>{execution.request_name}</h2>
        </div>
        {execution.response && (
          <span className="status-code">{execution.response.status}</span>
        )}
      </div>
      {execution.error && <div className="error-copy">{execution.error}</div>}
      {execution.assertions?.map((assertion) => (
        <div
          className={`assertion ${assertion.passed ? "passed" : "failed"}`}
          key={assertion.name}
        >
          {assertion.passed ? <Check size={14} /> : <AlertTriangle size={14} />}
          <div>
            <strong>{assertion.name}</strong>
            <small>{assertion.message}</small>
          </div>
        </div>
      ))}
      {execution.comparison?.differences.map((difference, index) => (
        <div className="difference" key={`${difference.path}-${index}`}>
          <div>
            <span>{difference.kind.replaceAll("_", " ")}</span>
            <code>{difference.path}</code>
          </div>
          <p>{difference.message}</p>
          <div className="values">
            <pre>{JSON.stringify(difference.baseline, null, 2)}</pre>
            <ChevronRight />
            <pre>{JSON.stringify(difference.current, null, 2)}</pre>
          </div>
        </div>
      ))}
      {execution.response && (
        <>
          <div className="response-meta">
            <span>{execution.response.content_type ?? "unknown type"}</span>
            <span>{formatBytes(execution.response.body_size)}</span>
            <span>{execution.response.duration_ms} ms</span>
          </div>
          <pre className="response-body">
            {prettyBody(execution.response.body)}
          </pre>
        </>
      )}
    </div>
  );
}

function RunsView({
  runs,
  onOpen,
}: {
  runs: Run[];
  onOpen: (run: Run) => void;
}) {
  return (
    <div className="workspace">
      <section className="collection-head">
        <div>
          <p className="eyebrow">ALL COLLECTIONS</p>
          <h1>Run history</h1>
          <p>Review, compare, and pin previous API responses.</p>
        </div>
      </section>
      <section className="panel">
        {runs.length ? (
          runs.map((run) => (
            <RunRow key={run.id} run={run} onClick={() => onOpen(run)} />
          ))
        ) : (
          <div className="mini-empty">
            <History />
            <strong>No matching runs</strong>
            <p>Run a collection to build response history.</p>
          </div>
        )}
      </section>
    </div>
  );
}
function RunRow({ run, onClick }: { run: Run; onClick: () => void }) {
  const changed = run.executions.filter((e) => e.state === "changed").length;
  return (
    <button className="run-row" onClick={onClick}>
      <StateIcon state={run.state} />
      <div>
        <strong>{run.collection_name}</strong>
        <small>
          {new Date(run.started_at).toLocaleString()} · {run.executions.length}{" "}
          endpoints
        </small>
      </div>
      {changed > 0 && <span>{changed} changed</span>}
      <ChevronRight />
    </button>
  );
}
function StateIcon({ state }: { state: string }) {
  return state.includes("failed") ? (
    <span className="state-icon bad">
      <AlertTriangle />
    </span>
  ) : state.includes("changed") || state.includes("findings") ? (
    <span className="state-icon warn">
      <FileDiff />
    </span>
  ) : (
    <span className="state-icon good">
      <Check />
    </span>
  );
}
function Stat({
  label,
  value,
  good,
  warn,
  bad,
}: {
  label: string;
  value: number;
  good?: boolean;
  warn?: boolean;
  bad?: boolean;
}) {
  return (
    <div className={`stat ${good ? "good" : warn ? "warn" : bad ? "bad" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function labelFor(view: View) {
  return view === "collections"
    ? "Collections"
    : view === "history"
      ? "History"
      : "Regressions";
}
function prettyBody(body: string) {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}
function formatBytes(value: number) {
  return value < 1024
    ? `${value} B`
    : value < 1048576
      ? `${(value / 1024).toFixed(1)} KiB`
      : `${(value / 1048576).toFixed(1)} MiB`;
}
