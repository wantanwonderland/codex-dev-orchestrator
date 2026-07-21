import { Activity, ArrowRight, Blocks, CircleAlert, GitBranch, Layers3, Radio, ShieldAlert, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { Metric } from "../components/Metric";
import { PageHeader } from "../components/PageHeader";
import { ProgressBar } from "../components/ProgressBar";
import { RateLimits } from "../components/RateLimits";
import { StatusBadge } from "../components/StatusBadge";
import { fallbacks, useApiData } from "../lib/data-context";
import { formatTokens, relativeTime } from "../lib/format";
import type { OverviewData } from "../types";

export function Overview() {
  const { data } = useApiData<OverviewData>("/api/overview", fallbacks.overviewMock);
  const active = data.projects.filter((p) => p.status !== "complete").length;
  const blocked = data.projects.filter((p) => p.status === "needs human").length;
  const projectTokens = data.projects.reduce((sum, p) => sum + p.tokens, 0);
  const tokens = data.tokenTotals?.totalTokens ?? projectTokens;
  const allocated = data.tokenTotals?.allocatedTokens ?? projectTokens;
  const attention = data.projects.filter((p) => p.health !== "healthy" || p.status === "reviewing");

  return <div className="page">
    <PageHeader eyebrow="Fleet command" title="Development overview" description="Live delivery state across every registered CDO project." actions={<div className="updated"><Radio size={14} />Observed {relativeTime(data.lastEventAt)}</div>} />

    <section className="metric-grid" aria-label="Fleet summary">
      <Metric label="Registered projects" value={data.projects.length} detail={`${data.projects.filter((p) => p.live).length} reporting live`} icon={Blocks} />
      <Metric label="Active workflows" value={active} detail={`${data.projects.filter((p) => p.status === "reviewing").length} awaiting review`} icon={Activity} tone="teal" />
      <Metric label="Human gates" value={blocked} detail={blocked ? "Safety or product decision required" : "Autonomy is uninterrupted"} icon={ShieldAlert} tone={blocked ? "red" : "neutral"} />
      <Metric label="Observed tokens" value={formatTokens(tokens)} detail={`${formatTokens(allocated)} allocated`} icon={Zap} tone="amber" />
    </section>

    <section className="section">
      <div className="section-heading"><div><span className="kicker">Fleet state</span><h2>Project health</h2></div><span className="section-note">Sorted by attention required</span></div>
      <div className="table-scroll">
        <table className="data-table project-table">
          <thead><tr><th>Project</th><th>Health</th><th>Development</th><th>Workflow</th><th>Agent / model</th><th>Progress</th><th>Tokens</th><th><span className="sr-only">Open</span></th></tr></thead>
          <tbody>{data.projects.map((project) => <tr key={project.id}>
            <td><Link className="primary-cell" to={`/projects/${project.id}`}><strong>{project.name}</strong><span><GitBranch size={12} />{project.branch}</span></Link></td>
            <td><StatusBadge status={project.health} /><span className="cell-sub">{relativeTime(project.updatedAt)}</span></td>
            <td><span className="developed-text">{project.developed}</span></td>
            <td><Link className="workflow-cell" to={`/projects/${project.id}/workflows/${project.workflowId}`}><strong>{project.phase}</strong><span>{project.workflowName}</span></Link></td>
            <td><div className="agent-cell"><strong>{project.role}</strong><span>{project.model}</span></div></td>
            <td><ProgressBar value={project.progress} tone={project.health === "offline" ? "red" : project.health === "warning" ? "amber" : "teal"} /></td>
            <td><strong className="token-value">{formatTokens(project.tokens)}</strong><StatusBadge status={project.coverage} /></td>
            <td><Link className="row-action" to={`/projects/${project.id}`} aria-label={`Open ${project.name}`}><ArrowRight size={16} /></Link></td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>

    <div className="split-band">
      <section className="section section--flat">
        <div className="section-heading"><div><span className="kicker">Queue</span><h2>Needs attention</h2></div><CircleAlert size={18} /></div>
        <div className="attention-list">{attention.map((project) => <Link to={`/projects/${project.id}`} className="attention-row" key={project.id}>
          <div className={`attention-row__icon attention-row__icon--${project.health}`}><Layers3 size={15} /></div>
          <div><strong>{project.name}</strong><span>{project.status === "needs human" ? "A typed safety or product gate needs a decision" : project.health === "offline" ? "Runtime stream is unavailable" : `${project.phase} requires attention`}</span></div>
          <StatusBadge status={project.health === "healthy" ? project.status : project.health} />
          <ArrowRight size={15} />
        </Link>)}</div>
      </section>
      <section className="section section--flat">
        <div className="section-heading"><div><span className="kicker">Capacity</span><h2>Rate limits</h2></div><Link className="text-link" to="/tokens">Token detail <ArrowRight size={14} /></Link></div>
        <RateLimits limits={data.rateLimits} />
      </section>
    </div>
  </div>;
}
