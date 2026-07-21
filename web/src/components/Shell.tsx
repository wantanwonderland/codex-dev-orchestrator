import { Activity, Boxes, ChevronLeft, CircleGauge, Menu, Radio, Settings, Workflow, X, Zap } from "lucide-react";
import { useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { relativeTime } from "../lib/format";
import { fallbacks, useApiData, useDataStatus } from "../lib/data-context";
import type { OverviewData } from "../types";

export function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { fallback, connection, lastEventAt } = useDataStatus();
  const { data: overview } = useApiData<OverviewData>("/api/overview", fallbacks.overviewMock);
  const firstProject = overview.projects[0] ?? fallbacks.overviewMock.projects[0];
  const nav = [
    { to: "/", label: "Overview", icon: CircleGauge, end: true },
    { to: `/projects/${firstProject.id}`, label: "Projects", icon: Boxes },
    { to: `/projects/${firstProject.id}/workflows/${firstProject.workflowId}`, label: "Workflows", icon: Workflow },
    { to: "/tokens", label: "Tokens", icon: Zap },
    { to: "/settings", label: "Settings", icon: Settings },
  ];
  return <div className="app-shell">
    <aside className={`sidebar ${open ? "sidebar--open" : ""}`}>
      <div className="brand"><div className="brand__mark"><Activity size={19} /></div><div><strong>CDO</strong><span>Development monitor</span></div><button className="icon-button sidebar__close" onClick={() => setOpen(false)} aria-label="Close navigation"><X size={18} /></button></div>
      <nav aria-label="Primary navigation">
        {nav.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)}><Icon size={17} /><span>{label}</span></NavLink>)}
      </nav>
      <div className="sidebar__footer">
        <div className="version"><span>CDO Console</span><strong>v0.4.0</strong></div>
        <div className="monitor-only"><Radio size={14} /><span><strong>Monitor only</strong>Workflow state is read-only</span></div>
      </div>
    </aside>
    {open && <button className="sidebar-backdrop" onClick={() => setOpen(false)} aria-label="Close navigation overlay" />}
    <div className="app-main">
      <div className="topbar">
        <button className="icon-button menu-button" onClick={() => setOpen(true)} aria-label="Open navigation"><Menu size={19} /></button>
        <div className="topbar__crumb"><ChevronLeft size={14} /> Multi-project development</div>
        <div className="topbar__status">
          {fallback && <span className="source-flag"><span>{import.meta.env.DEV ? "DEV" : "OFFLINE"}</span>{import.meta.env.DEV ? "Development data" : "No live data"}</span>}
          <span className={`connection connection--${connection}`}><i />{connection === "live" ? "Live stream" : connection === "connecting" ? "Connecting" : "Stream offline"}</span>
          <span className="last-event">Last event {relativeTime(lastEventAt)}</span>
        </div>
      </div>
      <main>{children}</main>
    </div>
  </div>;
}
