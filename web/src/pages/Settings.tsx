import { AlertTriangle, Clock3, DatabaseZap, FolderPlus, Radio, RefreshCw, Server, Trash2, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { fallbacks, useApiData } from "../lib/data-context";
import { relativeTime } from "../lib/format";
import type { RootEntry, SettingsData } from "../types";

type Toast = { message: string; tone: "success" | "error" } | null;

async function mutate(path: string, options: RequestInit) {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options.headers } });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.status === 204 ? null : response.json();
}

export function Settings() {
  const { data } = useApiData<SettingsData>("/api/settings", fallbacks.settingsMock);
  const [roots, setRoots] = useState<RootEntry[] | null>(null);
  const visibleRoots = roots ?? data.roots;
  const [path, setPath] = useState("");
  const [retention, setRetention] = useState(data.retentionDays);
  const [toast, setToast] = useState<Toast>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => setRetention(data.retentionDays), [data.retentionDays]);

  const addRoot = async (event: FormEvent) => {
    event.preventDefault();
    if (!path.trim()) return;
    setBusy(true);
    const optimistic: RootEntry = { id: `local-${Date.now()}`, path: path.trim(), state: "scanning", lastScan: new Date().toISOString(), projects: 0 };
    try {
      const created = await mutate("/api/roots", { method: "POST", body: JSON.stringify({ path: path.trim() }) });
      setRoots([...visibleRoots, (created as RootEntry | null) ?? optimistic]);
      setPath(""); setToast({ message: "Project root added.", tone: "success" });
    } catch {
      setToast({ message: "Could not add project root. API is unavailable.", tone: "error" });
    } finally { setBusy(false); }
  };

  const removeRoot = async (root: RootEntry) => {
    setBusy(true);
    try {
      await mutate(`/api/roots/${encodeURIComponent(root.id)}`, { method: "DELETE" });
      setRoots(visibleRoots.filter((item) => item.id !== root.id));
      setToast({ message: "Project root removed.", tone: "success" });
    } catch { setToast({ message: "Could not remove project root.", tone: "error" }); }
    finally { setBusy(false); }
  };

  const purge = async () => {
    setBusy(true);
    try {
      const before = new Date(Date.now() - retention * 24 * 60 * 60 * 1000).toISOString();
      await mutate("/api/purge", { method: "POST", body: JSON.stringify({ before, confirm: true }) });
      setToast({ message: "Expired monitoring history purged.", tone: "success" }); setPurgeOpen(false);
    } catch { setToast({ message: "Purge failed. No local state was changed.", tone: "error" }); }
    finally { setBusy(false); }
  };

  return <div className="page">
    <PageHeader eyebrow="Administration" title="Settings" description="Manage discovery roots and local monitoring retention. Development workflows remain read-only." />
    {toast && <div className={`toast toast--${toast.tone}`} role="status"><span>{toast.message}</span><button className="icon-button" onClick={() => setToast(null)} aria-label="Dismiss message"><X size={15} /></button></div>}

    <section className="settings-section">
      <div className="settings-intro"><div className="settings-intro__icon"><Server size={20} /></div><div><h2>Project discovery</h2><p>CDO scans registered roots for project workflow state and durable runtime evidence.</p></div></div>
      <form className="root-form" onSubmit={addRoot}><label><span>Project root</span><div className="input-button"><input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/workspace/customer-portal" aria-label="Project root" /><button className="button button--primary" disabled={busy || !path.trim()}><FolderPlus size={15} />Add project root</button></div></label></form>
      <div className="root-list">{visibleRoots.map((root) => <div className="root-row" key={root.id}>
        <div className="root-row__path"><strong>{root.path}</strong><span>{root.projects} {root.projects === 1 ? "project" : "projects"}</span></div>
        <StatusBadge status={root.state} />
        <span className="root-row__scan"><RefreshCw size={13} />{relativeTime(root.lastScan)}</span>
        <button className="icon-button icon-button--danger" onClick={() => removeRoot(root)} disabled={busy} title="Remove root" aria-label={`Remove ${root.path}`}><Trash2 size={15} /></button>
      </div>)}</div>
    </section>

    <section className="settings-section">
      <div className="settings-intro"><div className="settings-intro__icon"><DatabaseZap size={20} /></div><div><h2>History retention</h2><p>Controls expired local observations only. Active workflow artifacts and current snapshots are preserved.</p></div></div>
      <div className="retention-row"><label><span>Purge observations older than</span><select value={retention} onChange={(e) => setRetention(Number(e.target.value))}><option value={0}>Choose a cutoff</option><option value={7}>7 days</option><option value={14}>14 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select></label><div><span>Last purge</span><strong><Clock3 size={14} />{relativeTime(data.lastPurgeAt)}</strong></div><button className="button button--danger" onClick={() => setPurgeOpen(true)} disabled={retention === 0}><Trash2 size={15} />Purge expired history</button></div>
    </section>

    <section className="settings-section settings-section--status">
      <div className="settings-intro"><div className="settings-intro__icon"><Radio size={20} /></div><div><h2>Runtime connection</h2><p>Read-only event and API endpoints used by this monitor.</p></div></div>
      <div className="endpoint-list"><div><span>Event stream</span><code>{data.eventStreamUrl}</code><StatusBadge status="live" /></div><div><span>API base</span><code>/api</code><StatusBadge status="healthy" /></div><div><span>Codex OTLP</span><code>{data.telemetry?.path ?? "Not detected"}</code><StatusBadge status={data.telemetry?.configured ? "healthy" : "offline"} /></div><div><span>Background service</span><code>{data.service?.path ?? "Foreground only"}</code><StatusBadge status={data.service?.installed ? "active" : "offline"} /></div></div>
    </section>

    {purgeOpen && <div className="modal-backdrop" role="presentation"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="purge-title">
      <button className="icon-button modal__close" onClick={() => setPurgeOpen(false)} aria-label="Close"><X size={17} /></button>
      <div className="modal__icon"><AlertTriangle size={22} /></div><h2 id="purge-title">Purge expired history?</h2><p>Observations older than <strong>{retention} days</strong> will be deleted. Current snapshots, registered roots, workflows, and tracked artifacts are not affected.</p>
      <div className="modal__actions"><button className="button" onClick={() => setPurgeOpen(false)}>Cancel</button><button className="button button--danger" onClick={purge} disabled={busy}><Trash2 size={15} />Confirm purge</button></div>
    </div></div>}
  </div>;
}
