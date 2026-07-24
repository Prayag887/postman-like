import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Activity, Circle, Copy, Pause, Play, QrCode, Search, Settings, ShieldCheck, Square, Wifi, X } from "lucide-react";
import * as api from "./api";
import type { AndroidApp, AndroidDevice, BodyStorage, HttpTransaction, ProxyStatus, QrPairingChallenge } from "./types";

type InspectorTab = "Overview" | "Request" | "Response" | "Compare" | "cURL" | "Logs" | "Timeline";
export const duration = (tx: HttpTransaction) => tx.timing.response_complete_ms == null ? undefined :
  tx.timing.response_complete_ms - tx.timing.request_started_ms;
export const bodyText = (body?: BodyStorage) => {
  if (!body || body.storage === "empty") return "";
  if (body.storage === "unavailable") return body.reason;
  const bytes = body.storage === "inline" ? body.bytes : body.preview;
  return new TextDecoder().decode(new Uint8Array(bytes));
};
export const displayState = (tx: HttpTransaction) => {
  if (!tx.response) return "Pending";
  if (tx.response.status >= 400) return "Failed";
  if (tx.comparison?.differences.some((difference) => !difference.ignored)) return "Changed";
  return "Unchanged";
};
const jsonView = (value: string) => {
  try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
};

export function App() {
  const [transactions, setTransactions] = useState<HttpTransaction[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [proxy, setProxy] = useState<ProxyStatus>("stopped");
  const [capturing, setCapturing] = useState(false);
  const [paused, setPaused] = useState(false);
  const [query, setQuery] = useState("");
  const [changedOnly, setChangedOnly] = useState(false);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [tab, setTab] = useState<InspectorTab>("Overview");
  const [devices, setDevices] = useState<AndroidDevice[]>([]);
  const [device, setDevice] = useState("");
  const [apps, setApps] = useState<AndroidApp[]>([]);
  const [packageName, setPackageName] = useState("");
  const [notice, setNotice] = useState("");
  const [qrPairing, setQrPairing] = useState<QrPairingChallenge>();
  const [qrStatus, setQrStatus] = useState<"waiting"|"paired"|"failed">("waiting");

  useEffect(() => {
    void api.getProxyStatus().then(setProxy);
    void api.discoverDevices().then((items) => { setDevices(items); setDevice(items[0]?.serial ?? ""); });
    const stops = [
      listen<{payload: ProxyStatus}>("proxy-status-changed", e => setProxy(e.payload.payload)),
      listen<{payload: HttpTransaction}>("transaction-created", e =>
        setTransactions(current => [e.payload.payload, ...current])),
      listen<{payload: HttpTransaction}>("transaction-updated", e =>
        setTransactions(current => current.map(tx => tx.id === e.payload.payload.id ? e.payload.payload : tx))),
      listen<{payload: HttpTransaction}>("transaction-completed", e =>
        setTransactions(current => current.map(tx => tx.id === e.payload.payload.id ? e.payload.payload : tx))),
    ];
    return () => { void Promise.all(stops).then(unlisteners => unlisteners.forEach(stop => stop())); };
  }, []);
  useEffect(() => {
    if (!device) return;
    void api.listInstalledApps(device).then(items => { setApps(items); setPackageName(items[0]?.package_name ?? ""); });
  }, [device]);

  const visible = useMemo(() => transactions.filter(tx => {
    const haystack = `${tx.request.method} ${tx.request.host} ${tx.request.path} ${tx.response?.status ?? ""}`.toLowerCase();
    return haystack.includes(query.toLowerCase()) && (!changedOnly || displayState(tx) === "Changed") &&
      (!errorsOnly || displayState(tx) === "Failed" || tx.correlated_incidents.length > 0);
  }), [transactions, query, changedOnly, errorsOnly]);
  const selected = transactions.find(tx => tx.id === selectedId) ?? visible[0];

  async function start() {
    try {
      if (proxy === "certificate_required") { const ca = await api.generateCa(); setNotice(`CA generated: ${ca.fingerprint_sha256}`); }
      if (device) await api.configureAndroidProxy(device, "10.0.2.2", 8080);
      await api.startProxy(); setCapturing(true); setNotice("Capture active. Navigate the Android app manually.");
    } catch (error) { setNotice(String(error)); }
  }
  async function stop() {
    await api.stopProxy(); setCapturing(false);
    if (device) await api.clearAndroidProxy(device).catch(() => undefined);
  }
  async function pairWithQr() {
    try {
      setQrStatus("waiting");
      const challenge = await api.beginQrPairing();
      setQrPairing(challenge);
      const result = await api.finishQrPairing(challenge.id);
      setQrStatus("paired");
      setNotice(`Wireless device paired at ${result.endpoint}`);
      const items = await api.discoverDevices();
      setDevices(items);
      setDevice(items.find(item => item.connection_type === "wireless")?.serial ?? items[0]?.serial ?? "");
    } catch (error) {
      setQrStatus("failed");
      setNotice(String(error));
    }
  }
  function copy(value: string) { void navigator.clipboard.writeText(value); setNotice("Copied to clipboard"); }

  return <main className="shell">
    <header>
      <div className="brand"><Activity/><strong>App Tester</strong><span>Android Inspector</span></div>
      <div className={`proxy ${proxy}`}><Circle/>Proxy {proxy.replaceAll("_"," ")}</div>
      <select aria-label="Device" value={device} onChange={e=>setDevice(e.target.value)}>
        <option value="">Select device</option>{devices.map(item=><option key={item.serial}>{item.serial}</option>)}
      </select>
      <button className="qr-trigger" onClick={()=>void pairWithQr()}><QrCode/>Connect via QR</button>
      <select aria-label="Package" value={packageName} onChange={e=>setPackageName(e.target.value)}>
        <option value="">Select package</option>{apps.map(app=><option key={app.package_name}>{app.package_name}</option>)}
      </select>
      {capturing ? <button className="danger" onClick={()=>void stop()}><Square/>Stop capture</button> :
        <button className="primary" onClick={()=>void start()}><Play/>Start capture</button>}
      <button title="Settings"><Settings/></button>
    </header>
    <section className="filters">
      <label className="search"><Search/><input placeholder="Search method, host, path, status…" value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <button className={changedOnly?"active":""} onClick={()=>setChangedOnly(v=>!v)}>Changed only</button>
      <button className={errorsOnly?"active":""} onClick={()=>setErrorsOnly(v=>!v)}>Errors only</button>
      <button onClick={()=>setPaused(v=>!v)}>{paused?<Play/>:<Pause/>}{paused?"Resume":"Pause"} UI</button>
      <span className="count">{visible.length} requests</span>
    </section>
    {notice && <div className="notice">{notice}</div>}
    <section className="workspace">
      <div className="traffic">
        <div className="table-head"><span>Time</span><span>Method</span><span>Host / Path</span><span>Status</span><span>Duration</span><span>Size</span><span>Change</span><span>Issues</span></div>
        <div className="rows">
          {visible.map(tx => <button key={tx.id} onClick={()=>setSelectedId(tx.id)}
            className={`row ${selected?.id===tx.id?"selected":""} ${displayState(tx).toLowerCase()}`}>
            <span>{new Date(tx.created_at).toLocaleTimeString([], {hour12:false})}</span>
            <b className={`method ${tx.request.method.toLowerCase()}`}>{tx.request.method}</b>
            <span className="target"><strong>{tx.request.host}</strong><small>{tx.request.path}</small></span>
            <span>{tx.response?.status ?? "—"}</span><span>{duration(tx) == null ? "Pending" : `${duration(tx)} ms`}</span>
            <span>{tx.response ? `${tx.response.decoded_size} B` : "—"}</span>
            <span className="change">{displayState(tx)}</span><span>{tx.correlated_incidents.length || "—"}</span>
          </button>)}
          {!visible.length && <div className="empty"><ShieldCheck/><strong>No captured traffic yet</strong>
            <span>{proxy==="running"?"Navigate the selected Android app manually.":"Start capture and configure the device proxy to see requests live."}</span></div>}
        </div>
      </div>
      <aside className="inspector">
        {selected ? <><div className="inspector-title"><div><b>{selected.request.method}</b><strong>{selected.request.host}{selected.request.path}</strong></div>
          <button onClick={()=>copy(`${selected.request.scheme}://${selected.request.host}${selected.request.path}`)}><Copy/>URL</button></div>
          <nav>{(["Overview","Request","Response","Compare","cURL","Logs","Timeline"] as InspectorTab[]).map(name=>
            <button className={tab===name?"active":""} onClick={()=>setTab(name)} key={name}>{name}</button>)}</nav>
          <div className="panel">{tab==="Overview" && <Overview tx={selected}/>}
            {tab==="Request" && <Message headers={selected.request.headers} body={bodyText(selected.request.body)} onCopy={copy}/>}
            {tab==="Response" && <Message headers={selected.response?.headers ?? []} body={bodyText(selected.response?.body)} onCopy={copy}/>}
            {tab==="Compare" && <Compare tx={selected}/>}
            {tab==="cURL" && <Code value={selected.curl?.multiline ?? "cURL is generated when the request is captured."} onCopy={copy}/>}
            {tab==="Logs" && <div className="empty compact">Only developer-actionable logs correlated with this request appear here.</div>}
            {tab==="Timeline" && <Timeline tx={selected}/>}</div>
        </> : <div className="empty"><Activity/><strong>Select a request</strong><span>Request, response, comparison, cURL and correlated logs will appear here.</span></div>}
      </aside>
    </section>
    {qrPairing && <div className="modal-backdrop" role="presentation">
      <section className="qr-dialog" role="dialog" aria-modal="true" aria-labelledby="qr-title">
        <button className="close" aria-label="Close" onClick={()=>setQrPairing(undefined)}><X/></button>
        <div className="qr-heading"><Wifi/><div><h2 id="qr-title">Connect Android over Wi-Fi</h2>
          <p>Android 11 or newer · same Wi-Fi network</p></div></div>
        {qrStatus==="waiting" ? <><div className="qr-image" dangerouslySetInnerHTML={{__html:qrPairing.qr_svg}}/>
          <ol><li>Open <b>Settings → Developer options → Wireless debugging</b>.</li>
            <li>Tap <b>Pair device with QR code</b>.</li><li>Scan this code with Android’s pairing scanner.</li></ol>
          <div className="pairing-status"><span className="spinner"/>Waiting for the device…</div>
          <small>Expires {new Date(qrPairing.expires_at).toLocaleTimeString()}. This QR grants ADB access; only scan it on a device you control.</small></> :
          qrStatus==="paired" ? <div className="pair-result success"><ShieldCheck/><h3>Device connected</h3><p>The wireless device is now available in the device selector.</p>
            <button className="primary" onClick={()=>setQrPairing(undefined)}>Done</button></div> :
          <div className="pair-result failed"><Circle/><h3>Pairing failed</h3><p>{notice}</p><button onClick={()=>void pairWithQr()}>Generate a new QR</button></div>}
      </section>
    </div>}
  </main>;
}
function Overview({tx}:{tx:HttpTransaction}) { return <div className="overview">
  <label>Status<strong>{tx.response?.status ?? "Pending"}</strong></label><label>Duration<strong>{duration(tx) ?? "—"} ms</strong></label>
  <label>Content type<strong>{tx.response?.content_type ?? tx.request.content_type ?? "Unknown"}</strong></label>
  <label>HTTP<strong>{tx.response?.http_version ?? tx.request.http_version}</strong></label>
  <label>Capture quality<strong>{tx.capture_quality}</strong></label><label>Change<strong className={displayState(tx)==="Changed"?"red":""}>{displayState(tx)}</strong></label>
</div>; }
function Message({headers,body,onCopy}:{headers:{name:string;value:string}[];body:string;onCopy:(v:string)=>void}) {
  return <><h3>Headers <button onClick={()=>onCopy(headers.map(h=>`${h.name}: ${h.value}`).join("\n"))}><Copy/>Copy</button></h3>
    <div className="headers">{headers.map((h,i)=><div key={`${h.name}-${i}`}><b>{h.name}</b><span>{h.value}</span></div>)}</div>
    <h3>Body <button onClick={()=>onCopy(body)}><Copy/>Copy raw</button></h3><pre>{jsonView(body) || "No body"}</pre></>;
}
function Code({value,onCopy}:{value:string;onCopy:(v:string)=>void}) { return <div className="code"><button onClick={()=>onCopy(value)}><Copy/>Copy</button><pre>{value}</pre></div>; }
function Compare({tx}:{tx:HttpTransaction}) { const diffs=tx.comparison?.differences ?? []; return <div>
  <h3>{diffs.length ? `${diffs.length} differences` : "No compatible comparison available"}</h3>
  {diffs.map((diff,i)=><article className={`diff ${diff.severity}`} key={i}><b>{diff.path ?? diff.kind}</b><span>{diff.explanation}</span>
    <pre>Previous: {diff.previous ?? "—"}{"\n"}Current: {diff.current ?? "—"}</pre></article>)}</div>; }
function Timeline({tx}:{tx:HttpTransaction}) { return <ol className="timeline">
  <li>Request started <time>{new Date(tx.timing.request_started_ms).toLocaleTimeString()}</time></li>
  {tx.timing.request_complete_ms&&<li>Request complete</li>}{tx.timing.response_started_ms&&<li>Response headers</li>}
  {tx.timing.response_complete_ms&&<li>Response complete</li>}</ol>; }
