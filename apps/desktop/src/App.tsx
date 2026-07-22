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
  saveEnvironment,
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

export function removeRequestAndChooseNext(
  requests: ApiRequest[],
  requestId: string,
): { requests: ApiRequest[]; next?: ApiRequest; removed: boolean } {
  const index = requests.findIndex((item) => item.id === requestId);
  if (index < 0) {
    return { requests, next: requests[0], removed: false };
  }
  const remaining = requests.filter((item) => item.id !== requestId);
  return {
    requests: remaining,
    next: remaining[index] ?? remaining[index - 1],
    removed: true,
  };
}

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
  const [environmentsOpen, setEnvironmentsOpen] = useState(false);
  const [requestToDelete, setRequestToDelete] = useState<ApiRequest>();
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

  function newRequest(target = collection) {
    if (!target) return;
    setSelected(target.id);
    setEditingRequest({
      id: crypto.randomUUID(),
      collection_id: target.id,
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

  async function persistEnvironment(environment: Environment) {
    await saveEnvironment(environment);
    setEnvironments((current) => [
      environment,
      ...current.filter((item) => item.id !== environment.id),
    ]);
  }

  async function persistCollectionVariables(
    variables: Collection["variables"],
  ) {
    if (!collection) return;
    const next = { ...collection, variables };
    await saveCollection(next);
    setCollections((current) =>
      current.map((item) => (item.id === next.id ? next : item)),
    );
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
    const result = removeRequestAndChooseNext(collection.requests, request.id);
    if (!result.removed) {
      setEditingRequest(result.next);
      setRequestToDelete(undefined);
      return;
    }
    const next = { ...collection, requests: result.requests };
    await saveCollection(next);
    setCollections((current) =>
      current.map((item) => (item.id === next.id ? next : item)),
    );
    setEditingRequest(result.next);
    setRequestToDelete(undefined);
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
          <em>1.4</em>
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
              <button
                className="collection-add"
                title="Add request"
                aria-label={`Add request to ${item.name}`}
                onClick={() => newRequest(item)}
              >
                <Plus />
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
                    onDelete={(request) => {
                      setRequestToDelete(request);
                    }}
                  />
                  <button className="tree-new" onClick={() => newRequest()}>
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
            <button
              className="environment-button"
              onClick={() => setEnvironmentsOpen(true)}
            >
              Variables
            </button>
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
            onNewRequest={() => newRequest()}
            request={editingRequest}
            onSaveRequest={(request) =>
              persistRequest(request).catch((reason) =>
                setError(String(reason)),
              )
            }
            onDeleteRequest={(request) => setRequestToDelete(request)}
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
      {environmentsOpen && (
        <EnvironmentDialog
          collection={collection}
          environments={environments}
          activeId={environmentId}
          onSelect={setEnvironmentId}
          onImport={() => environmentFileRef.current?.click()}
          onSaveEnvironment={(environment) =>
            persistEnvironment(environment).catch((reason) =>
              setError(String(reason)),
            )
          }
          onSaveCollectionVariables={(variables) =>
            persistCollectionVariables(variables).catch((reason) =>
              setError(String(reason)),
            )
          }
          onClose={() => setEnvironmentsOpen(false)}
        />
      )}
      {requestToDelete && (
        <DeleteRequestDialog
          request={requestToDelete}
          saved={
            !!collection?.requests.some(
              (item) => item.id === requestToDelete.id,
            )
          }
          onCancel={() => setRequestToDelete(undefined)}
          onConfirm={() =>
            deleteRequest(requestToDelete).catch((reason) =>
              setError(String(reason)),
            )
          }
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
  onDelete,
}: {
  requests: ApiRequest[];
  activeId?: string;
  onSelect: (request: ApiRequest) => void;
  onDelete: (request: ApiRequest) => void;
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
          onDelete={onDelete}
        />
      ))}
      {root.requests.map((request) => (
        <RequestTreeItem
          key={request.id}
          request={request}
          active={activeId === request.id}
          onSelect={onSelect}
          onDelete={onDelete}
        />
      ))}
    </>
  );
}

function RequestFolder({
  folder,
  activeId,
  onSelect,
  onDelete,
}: {
  folder: RequestFolderNode;
  activeId?: string;
  onSelect: (request: ApiRequest) => void;
  onDelete: (request: ApiRequest) => void;
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
              onDelete={onDelete}
            />
          ))}
          {folder.requests.map((request) => (
            <RequestTreeItem
              key={request.id}
              request={request}
              active={activeId === request.id}
              onSelect={onSelect}
              onDelete={onDelete}
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
  onDelete,
}: {
  request: ApiRequest;
  active: boolean;
  onSelect: (request: ApiRequest) => void;
  onDelete: (request: ApiRequest) => void;
}) {
  return (
    <button
      className={active ? "active" : ""}
      title={`${request.method} ${request.url}`}
      onClick={() => onSelect(request)}
    >
      <ChevronRight className="request-chevron" />
      <span className={methodClass(request.method)}>{request.method}</span>
      <span className="request-name">{request.name}</span>
      <span
        className="tree-delete"
        role="button"
        tabIndex={0}
        aria-label={`Delete ${request.name}`}
        onClick={(event) => {
          event.stopPropagation();
          onDelete(request);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            onDelete(request);
          }
        }}
      >
        <Trash2 />
      </span>
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
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<Execution>();
  const [curlPasteError, setCurlPasteError] = useState<string>();
  useEffect(() => {
    setDraft(request);
    setResponse(undefined);
    setCurlPasteError(undefined);
  }, [request?.id]);
  const curl = useMemo(() => (draft ? requestToCurl(draft) : ""), [draft]);
  const persisted =
    !!draft && collection.requests.some((item) => item.id === draft.id);
  const dirty =
    !!draft &&
    !!request &&
    (!persisted || JSON.stringify(draft) !== JSON.stringify(request));

  function applyPastedCurl(source: string) {
    try {
      const imported = parseCurl(source, collection.id);
      setDraft({
        ...imported,
        id: draft!.id,
        collection_id: draft!.collection_id,
        folder_path: draft!.folder_path,
      });
      setCurlPasteError(undefined);
    } catch (reason) {
      setCurlPasteError(String(reason));
    }
  }

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
            onClick={() => onDelete(draft)}
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
              placeholder="Enter a URL or paste a complete cURL command"
              onPaste={(event) => {
                const source = event.clipboardData.getData("text").trim();
                if (/^(?:\$\s*)?curl(?:\s|$)/i.test(source)) {
                  event.preventDefault();
                  applyPastedCurl(source.replace(/^\$\s*/, ""));
                }
              }}
              spellCheck={false}
            />
            <button className="primary send" type="submit" disabled={sending}>
              <Play /> {sending ? "Sending…" : "Send"}
            </button>
          </div>
          <div className={curlPasteError ? "url-helper error" : "url-helper"}>
            {curlPasteError ??
              "Paste a URL or a complete cURL command here. cURL fills every request field automatically."}
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

function DeleteRequestDialog({
  request,
  saved,
  onCancel,
  onConfirm,
}: {
  request: ApiRequest;
  saved: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="dialog delete-dialog"
        role="alertdialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="delete-mark">
          <Trash2 />
        </div>
        <h2>
          {saved ? "Delete" : "Discard"} “{request.name}”?
        </h2>
        <p>
          {saved
            ? "The endpoint will be removed from this collection. Existing run history remains available until its retention date."
            : "This new request has not been saved yet. It will be discarded immediately."}
        </p>
        <div className="dialog-actions">
          <button className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="danger" onClick={onConfirm}>
            <Trash2 /> {saved ? "Delete request" : "Discard request"}
          </button>
        </div>
      </section>
    </div>
  );
}

function EnvironmentDialog({
  collection,
  environments,
  activeId,
  onSelect,
  onImport,
  onSaveEnvironment,
  onSaveCollectionVariables,
  onClose,
}: {
  collection?: Collection;
  environments: Environment[];
  activeId?: string;
  onSelect: (id?: string) => void;
  onImport: () => void;
  onSaveEnvironment: (environment: Environment) => void;
  onSaveCollectionVariables: (variables: Collection["variables"]) => void;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<"environment" | "collection">(
    "environment",
  );
  const selected =
    environments.find((item) => item.id === activeId) ?? environments[0];
  const [draft, setDraft] = useState<Environment | undefined>(selected);
  const [collectionVariables, setCollectionVariables] = useState(
    collection?.variables ?? [],
  );
  useEffect(() => setDraft(selected), [selected?.id]);
  useEffect(
    () => setCollectionVariables(collection?.variables ?? []),
    [collection?.id],
  );
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="dialog variables-dialog"
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-title">
          <div>
            <p className="eyebrow">POSTMAN VARIABLES</p>
            <h2>Environments and variables</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        <div className="variable-toolbar">
          <button
            className={scope === "environment" ? "active" : ""}
            onClick={() => setScope("environment")}
          >
            Environment
          </button>
          <button
            className={scope === "collection" ? "active" : ""}
            onClick={() => setScope("collection")}
          >
            Collection variables
          </button>
          <button className="secondary import-environment" onClick={onImport}>
            <Import /> Import Postman environment
          </button>
        </div>
        {scope === "environment" ? (
          <>
            <div className="environment-picker">
              <label>Active environment</label>
              <select
                value={draft?.id ?? ""}
                onChange={(event) => {
                  const next = environments.find(
                    (item) => item.id === event.target.value,
                  );
                  setDraft(next);
                  onSelect(next?.id);
                }}
              >
                {!environments.length && (
                  <option value="">No environment imported</option>
                )}
                {environments.map((environment) => (
                  <option key={environment.id} value={environment.id}>
                    {environment.name} · {environment.variables.length}{" "}
                    variables
                  </option>
                ))}
              </select>
            </div>
            {draft ? (
              <KeyValueEditor
                title={`${draft.name} variables`}
                rows={draft.variables}
                onChange={(variables) => setDraft({ ...draft, variables })}
              />
            ) : (
              <div className="variables-empty">
                <Import />
                <strong>Import your Postman environment file</strong>
                <p>
                  APIQA supports Postman environment JSON files and selects the
                  imported environment automatically.
                </p>
              </div>
            )}
            <div className="dialog-actions">
              <button className="secondary" onClick={onClose}>
                Close
              </button>
              <button
                className="primary"
                disabled={!draft}
                onClick={() => draft && onSaveEnvironment(draft)}
              >
                <Save /> Save environment
              </button>
            </div>
          </>
        ) : (
          <>
            <KeyValueEditor
              title={`${collection?.name ?? "Collection"} variables`}
              rows={collectionVariables}
              onChange={setCollectionVariables}
            />
            <div className="dialog-actions">
              <button className="secondary" onClick={onClose}>
                Close
              </button>
              <button
                className="primary"
                disabled={!collection}
                onClick={() => onSaveCollectionVariables(collectionVariables)}
              >
                <Save /> Save collection variables
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export function parseCurl(source: string, collectionId: string): ApiRequest {
  const tokens = tokenizeShell(source.trim());
  const curlIndex = tokens.findIndex(
    (token) => token === "curl" || token.endsWith("/curl"),
  );
  if (curlIndex < 0) throw new Error("Paste a command that starts with curl");
  let method = "GET";
  let url = "";
  let body: string | undefined;
  let auth: ApiRequest["auth"] = { type: "none" };
  const headers: ApiRequest["headers"] = [];
  for (let index = curlIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    const take = () => tokens[++index] ?? "";
    if (token === "-X" || token === "--request") method = take().toUpperCase();
    else if (token.startsWith("--request="))
      method = token.slice(10).toUpperCase();
    else if (token === "--url") url = take();
    else if (token.startsWith("--url=")) url = token.slice(6);
    else if (["-H", "--header"].includes(token))
      addCurlHeader(take(), headers, (next) => {
        auth = next;
      });
    else if (token.startsWith("--header="))
      addCurlHeader(token.slice(9), headers, (next) => {
        auth = next;
      });
    else if (token === "-u" || token === "--user") {
      const [username, ...password] = take().split(":");
      auth = { type: "basic", username, password: password.join(":") };
    } else if (
      [
        "-d",
        "--data",
        "--data-raw",
        "--data-binary",
        "--data-ascii",
        "--data-urlencode",
      ].includes(token)
    ) {
      body = take();
      if (method === "GET") method = "POST";
    } else if (token === "-G" || token === "--get") method = "GET";
    else if (!token.startsWith("-") && !url) url = token;
    else if (
      ["-A", "--user-agent", "-e", "--referer", "-b", "--cookie"].includes(
        token,
      )
    ) {
      const value = take();
      const key =
        token === "-A" || token === "--user-agent"
          ? "User-Agent"
          : token === "-e" || token === "--referer"
            ? "Referer"
            : "Cookie";
      headers.push({ key, value, enabled: true });
    }
  }
  if (!url) throw new Error("The cURL command does not contain a URL");
  const [baseUrl, queryString = ""] = url.split(/\?(.*)/s);
  const query = queryString
    ? queryString
        .split("&")
        .filter(Boolean)
        .map((pair) => {
          const [key, ...value] = pair.split("=");
          return {
            key: safeDecode(key),
            value: safeDecode(value.join("=")),
            enabled: true,
          };
        })
    : [];
  const pathName =
    baseUrl.split("/").filter(Boolean).at(-1)?.replaceAll(/[-_]/g, " ") ||
    "Imported cURL request";
  return {
    id: crypto.randomUUID(),
    collection_id: collectionId,
    folder_path: [],
    name: pathName,
    method,
    url: baseUrl,
    headers,
    query,
    body_kind: body === undefined ? "none" : "raw",
    body,
    auth,
    assertions: [],
    extractions: [],
    disabled: false,
  };
}

function addCurlHeader(
  source: string,
  headers: ApiRequest["headers"],
  setAuth: (auth: ApiRequest["auth"]) => void,
) {
  const separator = source.indexOf(":");
  if (separator < 0) return;
  const key = source.slice(0, separator).trim();
  const value = source.slice(separator + 1).trim();
  if (
    key.toLowerCase() === "authorization" &&
    value.toLowerCase().startsWith("bearer ")
  ) {
    setAuth({ type: "bearer", token: value.slice(7).trim() });
  } else headers.push({ key, value, enabled: true });
}

function tokenizeShell(source: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\" && quote !== "'") {
      const next = source[index + 1];
      if (next === "\n" || (next === "\r" && source[index + 2] === "\n")) {
        index += next === "\r" ? 2 : 1;
        continue;
      }
      if (next !== undefined) {
        current += next;
        index += 1;
      }
    } else if (character === "'" || character === '"') {
      if (!quote) quote = character;
      else if (quote === character) quote = "";
      else current += character;
    } else if (/\s/.test(character) && !quote) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else current += character;
  }
  if (quote) throw new Error("The cURL command has an unclosed quote");
  if (current) tokens.push(current);
  return tokens;
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value.replaceAll("+", " "));
  } catch {
    return value;
  }
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
