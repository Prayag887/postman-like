import { useEffect, useMemo, useRef, useState } from "react";
import { layout, prepare } from "@chenglou/pretext";
import {
  Activity,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  Download,
  FileDiff,
  FolderOpen,
  History,
  Import,
  Pin,
  Play,
  Plus,
  Search,
  Save,
  Settings,
  Share2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  exportWorkspaceFile,
  importCollection,
  importEnvironment,
  importWorkspace,
  listCollections,
  listEnvironments,
  listRuns,
  cleanupHistory,
  retentionPolicy,
  runCollection,
  runRequest,
  saveCollection,
  saveRetentionPolicy,
  setRunPinned,
} from "./api";
import type {
  ApiRequest,
  Collection,
  Environment,
  Execution,
  RetentionPolicy,
  Run,
} from "./types";

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
  const [editingRequest, setEditingRequest] = useState<ApiRequest>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const environmentFileRef = useRef<HTMLInputElement>(null);
  const workspaceFileRef = useRef<HTMLInputElement>(null);

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
    if (!collection) {
      setEditingRequest(undefined);
      return;
    }
    if (editingRequest?.collection_id !== collection.id) {
      setEditingRequest(collection.requests[0]);
    }
  }, [collection?.id]);

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

  async function onSendRequest(
    requestId: string,
  ): Promise<Execution | undefined> {
    if (!collection) return undefined;
    setError(undefined);
    const run = await runRequest(
      collection.id,
      requestId,
      collectionRuns[0]?.id,
      environmentId,
    );
    setRuns((current) => [
      run,
      ...current.filter((item) => item.id !== run.id),
    ]);
    return run.executions[0];
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

  async function onWorkspaceImport(file?: File) {
    if (!file) return;
    setError(undefined);
    try {
      const imported = await importWorkspace(await file.text());
      await refresh(imported[0]?.id);
      setView("collections");
      setShareOpen(false);
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function onWorkspaceExport(): Promise<string | undefined> {
    try {
      return await exportWorkspaceFile();
    } catch (reason) {
      setError(String(reason));
      return undefined;
    }
  }

  function newRequest() {
    if (!collection) return;
    setEditingRequest({
      id: crypto.randomUUID(),
      collection_id: collection.id,
      folder_path: [],
      name: "New request",
      method: "GET",
      url: "https://",
      headers: [],
      query: [],
      body_kind: "none",
      auth: { type: "none" },
      assertions: [],
      extractions: [],
      disabled: false,
    });
  }

  async function persistRequest(request: ApiRequest) {
    if (!collection) return;
    const next = {
      ...collection,
      requests: [
        ...collection.requests.filter((item) => item.id !== request.id),
        request,
      ],
    };
    await saveCollection(next);
    setCollections((current) =>
      current.map((item) => (item.id === next.id ? next : item)),
    );
    setEditingRequest(request);
  }

  async function deleteRequest(request: ApiRequest) {
    if (!collection) return;
    const index = collection.requests.findIndex(
      (item) => item.id === request.id,
    );
    const next = {
      ...collection,
      requests: collection.requests.filter((item) => item.id !== request.id),
    };
    await saveCollection(next);
    setCollections((current) =>
      current.map((item) => (item.id === next.id ? next : item)),
    );
    setEditingRequest(next.requests[index] ?? next.requests[index - 1]);
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
          <em>1.2</em>
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
            <div className="collection-tree" key={item.id}>
              <button
                className={`collection-item ${selected === item.id ? "active" : ""}`}
                onClick={() => {
                  setSelected(item.id);
                  setEditingRequest(item.requests[0]);
                  setActiveRun(undefined);
                  setActiveExecution(undefined);
                }}
              >
                {selected === item.id ? <ChevronDown /> : <ChevronRight />}
                <FolderOpen />
                <span>{item.name}</span>
                <small>{item.requests.length}</small>
              </button>
              {selected === item.id && view === "collections" && (
                <div className="request-tree">
                  <CollectionRequestTree
                    requests={item.requests}
                    activeId={editingRequest?.id}
                    onSelect={(request) => {
                      setEditingRequest(request);
                      setActiveRun(undefined);
                    }}
                  />
                  <button className="tree-new" onClick={newRequest}>
                    <Plus /> <span>Add request</span>
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        <button
          className="import-side"
          onClick={() => fileRef.current?.click()}
        >
          <Import size={16} /> Import Postman
        </button>
        <button
          className="sidebar-footer"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings size={16} />
          <span>Settings</span>
          <kbd>⌘,</kbd>
        </button>
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
            <button className="share-button" onClick={() => setShareOpen(true)}>
              <Share2 /> Share workspace
            </button>
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
            onSendRequest={(requestId) =>
              onSendRequest(requestId).catch((reason) => {
                setError(String(reason));
                return undefined;
              })
            }
            onOpenRun={setActiveRun}
            activeExecution={activeExecution}
            onExecution={setActiveExecution}
            onNewRequest={newRequest}
            request={editingRequest}
            onSaveRequest={(request) =>
              persistRequest(request).catch((reason) =>
                setError(String(reason)),
              )
            }
            onDeleteRequest={(request) =>
              deleteRequest(request).catch((reason) => setError(String(reason)))
            }
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
      <input
        ref={workspaceFileRef}
        type="file"
        hidden
        accept=".apiqa-workspace,application/json"
        onChange={(event) => onWorkspaceImport(event.target.files?.[0])}
      />
      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          onError={(reason) => setError(String(reason))}
          onCleaned={() => refresh()}
        />
      )}
      {shareOpen && (
        <ShareWorkspaceDialog
          collectionCount={collections.length}
          environmentCount={environments.length}
          onClose={() => setShareOpen(false)}
          onExport={onWorkspaceExport}
          onImport={() => workspaceFileRef.current?.click()}
        />
      )}
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

interface RequestFolderNode {
  name: string;
  folders: RequestFolderNode[];
  requests: ApiRequest[];
}

function buildRequestTree(requests: ApiRequest[]): RequestFolderNode {
  const root: RequestFolderNode = { name: "", folders: [], requests: [] };
  for (const request of requests) {
    let node = root;
    for (const folderName of request.folder_path) {
      let folder = node.folders.find((item) => item.name === folderName);
      if (!folder) {
        folder = { name: folderName, folders: [], requests: [] };
        node.folders.push(folder);
      }
      node = folder;
    }
    node.requests.push(request);
  }
  return root;
}

function CollectionRequestTree({
  requests,
  activeId,
  onSelect,
}: {
  requests: ApiRequest[];
  activeId?: string;
  onSelect: (request: ApiRequest) => void;
}) {
  const root = useMemo(() => buildRequestTree(requests), [requests]);
  return (
    <>
      {root.folders.map((folder) => (
        <RequestFolder
          key={folder.name}
          folder={folder}
          activeId={activeId}
          onSelect={onSelect}
        />
      ))}
      {root.requests.map((request) => (
        <RequestTreeItem
          key={request.id}
          request={request}
          active={activeId === request.id}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

function RequestFolder({
  folder,
  activeId,
  onSelect,
}: {
  folder: RequestFolderNode;
  activeId?: string;
  onSelect: (request: ApiRequest) => void;
}) {
  const containsActive =
    folder.requests.some((item) => item.id === activeId) ||
    folder.folders.some((item) => folderContains(item, activeId));
  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    if (containsActive) setExpanded(true);
  }, [containsActive]);
  return (
    <div className="request-folder">
      <button className="folder-row" onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown /> : <ChevronRight />}
        <FolderOpen />
        <span>{folder.name}</span>
      </button>
      {expanded && (
        <div className="folder-children">
          {folder.folders.map((child) => (
            <RequestFolder
              key={child.name}
              folder={child}
              activeId={activeId}
              onSelect={onSelect}
            />
          ))}
          {folder.requests.map((request) => (
            <RequestTreeItem
              key={request.id}
              request={request}
              active={activeId === request.id}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function folderContains(folder: RequestFolderNode, activeId?: string): boolean {
  return (
    folder.requests.some((item) => item.id === activeId) ||
    folder.folders.some((item) => folderContains(item, activeId))
  );
}

function RequestTreeItem({
  request,
  active,
  onSelect,
}: {
  request: ApiRequest;
  active: boolean;
  onSelect: (request: ApiRequest) => void;
}) {
  return (
    <button
      className={active ? "active" : ""}
      title={`${request.method} ${request.url}`}
      onClick={() => onSelect(request)}
    >
      <ChevronRight className="request-chevron" />
      <span className={methodClass(request.method)}>{request.method}</span>
      <span>{request.name}</span>
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
  onSendRequest,
  onOpenRun,
  activeExecution,
  onExecution,
  onNewRequest,
  request,
  onSaveRequest,
  onDeleteRequest,
}: {
  collection?: Collection;
  runs: Run[];
  activeRun?: Run;
  running: boolean;
  summary: { total: number; passed: number; changed: number; failed: number };
  onRun: () => void;
  onSendRequest: (requestId: string) => Promise<Execution | undefined>;
  onOpenRun: (run: Run) => void;
  activeExecution?: Execution;
  onExecution: (execution: Execution) => void;
  onNewRequest: () => void;
  request?: ApiRequest;
  onSaveRequest: (request: ApiRequest) => Promise<void>;
  onDeleteRequest: (request: ApiRequest) => void;
}) {
  if (!collection) return null;
  if (activeRun) {
    return (
      <div className="workspace">
        <RunReport
          run={activeRun}
          summary={summary}
          active={activeExecution}
          onExecution={onExecution}
        />
      </div>
    );
  }
  return (
    <RequestWorkspace
      collection={collection}
      request={request}
      running={running}
      runs={runs}
      onRun={onRun}
      onSend={onSendRequest}
      onOpenRun={onOpenRun}
      onNewRequest={onNewRequest}
      onSave={onSaveRequest}
      onDelete={onDeleteRequest}
    />
  );
}

type RequestTab =
  | "docs"
  | "params"
  | "authorization"
  | "headers"
  | "body"
  | "tests"
  | "settings";

function RequestWorkspace({
  collection,
  request,
  running,
  runs,
  onRun,
  onSend,
  onOpenRun,
  onNewRequest,
  onSave,
  onDelete,
}: {
  collection: Collection;
  request?: ApiRequest;
  running: boolean;
  runs: Run[];
  onRun: () => void;
  onSend: (requestId: string) => Promise<Execution | undefined>;
  onOpenRun: (run: Run) => void;
  onNewRequest: () => void;
  onSave: (request: ApiRequest) => Promise<void>;
  onDelete: (request: ApiRequest) => void;
}) {
  const [draft, setDraft] = useState(request);
  const [tab, setTab] = useState<RequestTab>("params");
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<Execution>();
  useEffect(() => {
    setDraft(request);
    setConfirmDelete(false);
    setResponse(undefined);
  }, [request?.id]);
  const curl = useMemo(() => (draft ? requestToCurl(draft) : ""), [draft]);
  const dirty =
    !!draft && !!request && JSON.stringify(draft) !== JSON.stringify(request);

  if (!draft) {
    return (
      <section className="request-empty">
        <FolderOpen />
        <h1>{collection.name}</h1>
        <p>This collection has no requests yet.</p>
        <button className="primary" onClick={onNewRequest}>
          <Plus /> Create request
        </button>
      </section>
    );
  }

  return (
    <div className="request-workspace">
      <section className="request-main">
        <div className="request-tabbar">
          <div className="request-tab active">
            <span className={methodClass(draft.method)}>{draft.method}</span>
            <input
              aria-label="Request name"
              value={draft.name}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
            />
            {dirty && <i title="Unsaved changes" />}
          </div>
          <button
            className="tab-add"
            onClick={onNewRequest}
            aria-label="New request"
          >
            <Plus />
          </button>
          <div className="request-tab-actions">
            <button
              className="secondary compact"
              onClick={() => onOpenRun(runs[0])}
              disabled={!runs.length}
            >
              History
            </button>
            <button
              className="primary compact"
              disabled={running}
              onClick={onRun}
            >
              <Play fill="currentColor" />{" "}
              {running ? "Running…" : "Run collection"}
            </button>
          </div>
        </div>

        <div className="request-context">
          <div className="request-breadcrumb">
            <span>{collection.name}</span>
            {draft.folder_path.map((folder) => (
              <span key={folder}>
                <ChevronRight /> {folder}
              </span>
            ))}
            <strong>
              <ChevronRight /> {draft.name}
            </strong>
          </div>
          <button
            className="context-save"
            disabled={!dirty}
            onClick={() => onSave(draft)}
          >
            <Save /> Save
          </button>
          <button
            className="context-delete"
            onClick={() => setConfirmDelete(true)}
            title="Delete request"
          >
            <Trash2 />
          </button>
        </div>

        <form
          className="request-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setSending(true);
            try {
              if (dirty) await onSave(draft);
              setResponse(await onSend(draft.id));
            } finally {
              setSending(false);
            }
          }}
        >
          <div className="request-urlbar">
            <select
              value={draft.method}
              onChange={(event) =>
                setDraft({ ...draft, method: event.target.value })
              }
              aria-label="HTTP method"
            >
              {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map(
                (method) => (
                  <option key={method}>{method}</option>
                ),
              )}
            </select>
            <input
              value={draft.url}
              onChange={(event) =>
                setDraft({ ...draft, url: event.target.value })
              }
              aria-label="Request URL"
              spellCheck={false}
            />
            <button className="primary send" type="submit" disabled={sending}>
              <Play /> {sending ? "Sending…" : "Send"}
            </button>
          </div>

          {collection.import_warnings.length > 0 && (
            <div
              className="inline-warning"
              title={collection.import_warnings.join("\n")}
            >
              <AlertTriangle /> {collection.import_warnings.length} import
              warning{collection.import_warnings.length === 1 ? "" : "s"}
            </div>
          )}

          <div className="editor-tabs" role="tablist">
            {(
              [
                "docs",
                "params",
                "authorization",
                "headers",
                "body",
                "tests",
                "settings",
              ] as RequestTab[]
            ).map((item) => (
              <button
                type="button"
                role="tab"
                aria-selected={tab === item}
                className={tab === item ? "active" : ""}
                key={item}
                onClick={() => setTab(item)}
              >
                {item[0].toUpperCase() + item.slice(1)}
                {item === "params" && enabledCount(draft.query) > 0 && (
                  <b>{enabledCount(draft.query)}</b>
                )}
                {item === "headers" && enabledCount(draft.headers) > 0 && (
                  <b>{enabledCount(draft.headers)}</b>
                )}
              </button>
            ))}
          </div>

          <div className="editor-content">
            {tab === "docs" && (
              <div className="docs-editor">
                <div className="editor-section-head">
                  <strong>Request documentation</strong>
                </div>
                <h3>{draft.name}</h3>
                <code>
                  {draft.method} {draft.url}
                </code>
                <p>
                  This request was imported from {collection.name}. Variables
                  use the <code>{"{{variable}}"}</code> format.
                </p>
              </div>
            )}
            {tab === "params" && (
              <KeyValueEditor
                title="Query Params"
                rows={draft.query}
                onChange={(query) => setDraft({ ...draft, query })}
              />
            )}
            {tab === "headers" && (
              <KeyValueEditor
                title="Headers"
                rows={draft.headers}
                onChange={(headers) => setDraft({ ...draft, headers })}
              />
            )}
            {tab === "authorization" && (
              <AuthorizationEditor request={draft} onChange={setDraft} />
            )}
            {tab === "body" && (
              <div className="body-editor">
                <div className="editor-section-head">
                  <strong>Request body</strong>
                  <select
                    value={draft.body_kind}
                    onChange={(event) =>
                      setDraft({ ...draft, body_kind: event.target.value })
                    }
                  >
                    <option value="none">none</option>
                    <option value="raw">raw / JSON</option>
                    <option value="url_encoded">x-www-form-urlencoded</option>
                    <option value="form_data">form-data</option>
                  </select>
                </div>
                {draft.body_kind === "none" ? (
                  <div className="editor-placeholder">
                    This request does not have a body.
                  </div>
                ) : (
                  <textarea
                    value={draft.body ?? ""}
                    onChange={(event) =>
                      setDraft({ ...draft, body: event.target.value })
                    }
                    placeholder={'{\n  "key": "value"\n}'}
                    spellCheck={false}
                  />
                )}
              </div>
            )}
            {tab === "tests" && (
              <div className="tests-editor">
                <div className="editor-section-head">
                  <strong>Response tests</strong>
                  <span>{draft.assertions.length} configured</span>
                </div>
                {draft.assertions.length ? (
                  <pre>{JSON.stringify(draft.assertions, null, 2)}</pre>
                ) : (
                  <div className="editor-placeholder">
                    No response assertions are configured.
                  </div>
                )}
              </div>
            )}
            {tab === "settings" && (
              <div className="request-settings">
                <div className="editor-section-head">
                  <strong>Request settings</strong>
                </div>
                <label>
                  <input
                    type="checkbox"
                    checked={!draft.disabled}
                    onChange={(event) =>
                      setDraft({ ...draft, disabled: !event.target.checked })
                    }
                  />{" "}
                  Include this request in collection runs
                </label>
                <p>
                  Disabled requests stay in the collection but are skipped by
                  automation.
                </p>
              </div>
            )}
          </div>
        </form>

        <div
          className={`response-placeholder ${response ? "has-response" : ""}`}
        >
          {response ? (
            <div className="inline-response">
              <div className="inline-response-head">
                <strong>Response</strong>
                {response.response && (
                  <>
                    <span className="status-code">
                      {response.response.status}
                    </span>
                    <span>{response.response.duration_ms} ms</span>
                    <span>{formatBytes(response.response.body_size)}</span>
                  </>
                )}
              </div>
              {response.error ? (
                <div className="error-copy">{response.error}</div>
              ) : (
                <pre>{prettyBody(response.response?.body ?? "")}</pre>
              )}
            </div>
          ) : (
            <>
              <div>
                <strong>Response</strong>
                <span>Send this request to inspect the latest response.</span>
              </div>
              {runs[0] && (
                <button onClick={() => onOpenRun(runs[0])}>
                  Open latest run <ChevronRight />
                </button>
              )}
            </>
          )}
        </div>
      </section>

      <aside className="code-sidebar">
        <div className="code-head">
          <div>
            <span>Code snippet</span>
            <strong>cURL</strong>
          </div>
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(curl);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <PretextCode>{curl}</PretextCode>
        <div className="code-note">
          <strong>Ready for your terminal</strong>
          <p>
            Variables stay in Postman format so you can see exactly what will be
            substituted at run time.
          </p>
        </div>
      </aside>

      {confirmDelete && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setConfirmDelete(false)}
        >
          <section
            className="dialog delete-dialog"
            role="alertdialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="delete-mark">
              <Trash2 />
            </div>
            <h2>Delete “{draft.name}”?</h2>
            <p>
              The endpoint will be removed from this collection. Existing run
              history remains available until its retention date.
            </p>
            <div className="dialog-actions">
              <button
                className="secondary"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </button>
              <button className="danger" onClick={() => onDelete(draft)}>
                <Trash2 /> Delete request
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function KeyValueEditor({
  title,
  rows,
  onChange,
}: {
  title: string;
  rows: ApiRequest["headers"];
  onChange: (rows: ApiRequest["headers"]) => void;
}) {
  const visible = [...rows, { key: "", value: "", enabled: true }];
  function update(index: number, patch: Partial<(typeof visible)[number]>) {
    const next = [...visible];
    next[index] = { ...next[index], ...patch };
    onChange(next.filter((row) => row.key || row.value));
  }
  return (
    <div className="kv-editor">
      <div className="editor-section-head">
        <strong>{title}</strong>
        <span>{rows.length} configured</span>
      </div>
      <div className="kv-head">
        <span />
        <span>Key</span>
        <span>Value</span>
        <span />
      </div>
      {visible.map((row, index) => (
        <div className="kv-row" key={`${index}-${rows.length}`}>
          <input
            type="checkbox"
            checked={row.enabled}
            onChange={(event) =>
              update(index, { enabled: event.target.checked })
            }
            aria-label="Enable row"
          />
          <input
            value={row.key}
            onChange={(event) => update(index, { key: event.target.value })}
            placeholder="Key"
          />
          <input
            value={row.value}
            onChange={(event) => update(index, { value: event.target.value })}
            placeholder="Value"
          />
          <button
            type="button"
            onClick={() =>
              onChange(rows.filter((_, rowIndex) => rowIndex !== index))
            }
            disabled={index === rows.length}
            aria-label="Remove row"
          >
            <X />
          </button>
        </div>
      ))}
    </div>
  );
}

function AuthorizationEditor({
  request,
  onChange,
}: {
  request: ApiRequest;
  onChange: (request: ApiRequest) => void;
}) {
  const auth = request.auth;
  const type = auth.type;
  const setAuth = (patch: Record<string, unknown>) =>
    onChange({ ...request, auth: { ...auth, ...patch } });
  return (
    <div className="auth-editor">
      <div className="auth-type">
        <label>Auth type</label>
        <select
          value={type}
          onChange={(event) =>
            onChange({ ...request, auth: { type: event.target.value } })
          }
        >
          <option value="none">No Auth</option>
          <option value="bearer">Bearer Token</option>
          <option value="basic">Basic Auth</option>
          <option value="api_key">API Key</option>
        </select>
      </div>
      <div className="auth-fields">
        {type === "none" && (
          <div className="editor-placeholder">
            This request does not use authorization.
          </div>
        )}
        {type === "bearer" && (
          <label>
            Token
            <input
              value={String(auth.token ?? "")}
              onChange={(event) => setAuth({ token: event.target.value })}
              placeholder="Token"
            />
          </label>
        )}
        {type === "basic" && (
          <>
            <label>
              Username
              <input
                value={String(auth.username ?? "")}
                onChange={(event) => setAuth({ username: event.target.value })}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={String(auth.password ?? "")}
                onChange={(event) => setAuth({ password: event.target.value })}
              />
            </label>
          </>
        )}
        {type === "api_key" && (
          <>
            <label>
              Key
              <input
                value={String(auth.key ?? "")}
                onChange={(event) => setAuth({ key: event.target.value })}
              />
            </label>
            <label>
              Value
              <input
                value={String(auth.value ?? "")}
                onChange={(event) => setAuth({ value: event.target.value })}
              />
            </label>
            <label>
              Add to
              <select
                value={String(auth.location ?? "header")}
                onChange={(event) => setAuth({ location: event.target.value })}
              >
                <option value="header">Header</option>
                <option value="query">Query</option>
              </select>
            </label>
          </>
        )}
      </div>
    </div>
  );
}

function PretextCode({ children }: { children: string }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let prepared = prepare(children, "10px ui-monospace");
    const relayout = () => {
      const result = layout(
        prepared,
        Math.max(100, element.clientWidth - 34),
        17.5,
      );
      element.style.minHeight = `${Math.max(260, result.height + 34)}px`;
    };
    prepared = prepare(children, getComputedStyle(element).font);
    const observer = new ResizeObserver(relayout);
    observer.observe(element);
    relayout();
    return () => observer.disconnect();
  }, [children]);
  return <pre ref={ref}>{children}</pre>;
}

function enabledCount(rows: ApiRequest["headers"]) {
  return rows.filter((row) => row.enabled).length;
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function requestToCurl(request: ApiRequest) {
  const query = request.query
    .filter((row) => row.enabled && row.key)
    .map(
      (row) =>
        `${encodeURIComponent(row.key)}=${encodeURIComponent(row.value)}`,
    )
    .join("&");
  const url =
    request.url +
    (query ? `${request.url.includes("?") ? "&" : "?"}${query}` : "");
  const lines = [
    `curl --request ${request.method} \\`,
    `  --url ${shellQuote(url)}`,
  ];
  for (const header of request.headers.filter(
    (row) => row.enabled && row.key,
  )) {
    lines[lines.length - 1] += " \\";
    lines.push(`  --header ${shellQuote(`${header.key}: ${header.value}`)}`);
  }
  if (request.auth.type === "bearer" && request.auth.token) {
    lines[lines.length - 1] += " \\";
    lines.push(
      `  --header ${shellQuote(`Authorization: Bearer ${String(request.auth.token)}`)}`,
    );
  }
  if (request.auth.type === "basic") {
    lines[lines.length - 1] += " \\";
    lines.push(
      `  --user ${shellQuote(`${String(request.auth.username ?? "")}:${String(request.auth.password ?? "")}`)}`,
    );
  }
  if (request.body_kind !== "none" && request.body) {
    lines[lines.length - 1] += " \\";
    lines.push(`  --data-raw ${shellQuote(request.body)}`);
  }
  return lines.join("\n");
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
      {execution.extractions?.map((extraction) => (
        <div
          className="extraction"
          key={`${extraction.name}-${extraction.source}`}
        >
          <span>EXTRACTED</span>
          <code>{extraction.name}</code>
          <strong>{extraction.value}</strong>
          <small>{extraction.source}</small>
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

function ShareWorkspaceDialog({
  collectionCount,
  environmentCount,
  onClose,
  onExport,
  onImport,
}: {
  collectionCount: number;
  environmentCount: number;
  onClose: () => void;
  onExport: () => Promise<string | undefined>;
  onImport: () => void;
}) {
  const [savedPath, setSavedPath] = useState<string>();
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="dialog share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-workspace-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-title">
          <div>
            <p className="eyebrow">PORTABLE WORKSPACE</p>
            <h2 id="share-workspace-title">Share your APIQA workspace</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        <p className="share-summary">
          Package {collectionCount} collection{collectionCount === 1 ? "" : "s"}{" "}
          and {environmentCount} environment{environmentCount === 1 ? "" : "s"}{" "}
          into one file that another APIQA user can open.
        </p>
        <div className="share-safety">
          <Check /> Token, secret, password, and API-key environment values are
          removed automatically. Request definitions and non-secret variables
          are included.
        </div>
        <button
          className="share-option primary"
          onClick={async () => setSavedPath(await onExport())}
        >
          <Download />
          <span>
            <strong>Export workspace</strong>
            <small>Create a shareable .apiqa-workspace file</small>
          </span>
          <ChevronRight />
        </button>
        {savedPath && (
          <div className="workspace-saved">
            <Check />
            <span>
              <strong>Workspace exported</strong>
              <small>{savedPath}</small>
            </span>
          </div>
        )}
        <button className="share-option secondary" onClick={onImport}>
          <Upload />
          <span>
            <strong>Open shared workspace</strong>
            <small>Import collections and environments from a teammate</small>
          </span>
          <ChevronRight />
        </button>
      </section>
    </div>
  );
}

function SettingsDialog({
  onClose,
  onError,
  onCleaned,
}: {
  onClose: () => void;
  onError: (reason: unknown) => void;
  onCleaned: () => void;
}) {
  const [policy, setPolicy] = useState<RetentionPolicy>({ days: 30 });
  const [message, setMessage] = useState("");
  useEffect(() => {
    retentionPolicy().then(setPolicy).catch(onError);
  }, []);
  async function saveAndClean() {
    try {
      await saveRetentionPolicy(policy);
      const result = await cleanupHistory();
      setMessage(
        `Cleaned ${result.deleted_runs} runs and reclaimed ${formatBytes(result.reclaimed_bytes)}.`,
      );
      onCleaned();
    } catch (reason) {
      onError(reason);
    }
  }
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="dialog settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-title">
          <div>
            <p className="eyebrow">LOCAL STORAGE</p>
            <h2 id="settings-title">History settings</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        <p>
          Keep response history long enough to compare weekly releases. Pinned
          baselines are always protected.
        </p>
        <label>
          Keep run history
          <select
            value={policy.days}
            onChange={(event) =>
              setPolicy({ ...policy, days: Number(event.target.value) })
            }
          >
            {[7, 14, 30, 60, 90].map((days) => (
              <option key={days} value={days}>
                {days} days
              </option>
            ))}
          </select>
        </label>
        <label>
          Optional storage limit (GiB)
          <input
            type="number"
            min="1"
            placeholder="Unlimited"
            value={policy.max_bytes ? policy.max_bytes / 1073741824 : ""}
            onChange={(event) =>
              setPolicy({
                ...policy,
                max_bytes: event.target.value
                  ? Number(event.target.value) * 1073741824
                  : undefined,
              })
            }
          />
        </label>
        {message && (
          <div className="success-message">
            <Check /> {message}
          </div>
        )}
        <div className="dialog-actions">
          <button className="secondary" onClick={onClose}>
            Close
          </button>
          <button className="primary" onClick={saveAndClean}>
            Save and clean now
          </button>
        </div>
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
