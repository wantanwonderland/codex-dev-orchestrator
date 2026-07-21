import { ArrowRight, CalendarClock, CheckCircle2, CircleSlash2, FolderGit2, GitBranch, ListChecks, Radio, ServerOff, Workflow as WorkflowIcon, Zap } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { History } from "../components/History";
import { Metric } from "../components/Metric";
import { PageHeader } from "../components/PageHeader";
import { ProgressBar } from "../components/ProgressBar";
import { StatusBadge } from "../components/StatusBadge";
import { fallbacks, useApiData } from "../lib/data-context";
import { formatTokens, relativeTime } from "../lib/format";
import type { ProjectDetail } from "../types";

export function Project() {
  const { id = "cdo-core" } = useParams();
  const fallback = fallbacks.projectMocks[id] ?? fallbacks.projectMocks["cdo-core"];
  const { data } = useApiData<ProjectDetail>(`/api/projects/${id}`, fallback);

  return <div className="page">
    <PageHeader eyebrow="Project detail" title={data.name} description={data.path} actions={<><StatusBadge status={data.health} /><span className="updated"><Radio size={14} />{data.live ? "Reporting" : `Last seen ${relativeTime(data.lastSync)}`}</span></>} />
    {!data.live && <div className="notice notice--offline"><ServerOff size={18} /><div><strong>Project telemetry is offline</strong><span>Showing the last durable snapshot from {new Date(data.lastSync).toLocaleString()}. Live token categories may be incomplete.</span></div></div>}

    <section className="metric-grid metric-grid--project">
      <Metric label="Current branch" value={data.branch} detail={`Default: ${data.defaultBranch}`} icon={GitBranch} />
      <Metric label="Workflow phase" value={data.phase} detail={data.workflowName} icon={WorkflowIcon} tone="teal" />
      <Metric label="Task completion" value={`${data.tasks.complete}/${data.tasks.total}`} detail={`${data.tasks.blocked} human gates`} icon={ListChecks} tone={data.tasks.blocked ? "red" : "neutral"} />
      <Metric label="Observed tokens" value={formatTokens(data.tokens)} detail={`${data.coverage} coverage`} icon={Zap} tone="amber" />
    </section>

    <div className="split-band split-band--project">
      <section className="section section--flat">
        <div className="section-heading"><div><span className="kicker">Current delivery</span><h2>What developed</h2></div><StatusBadge status={data.status} /></div>
        <div className="developed-summary">
          <div className="developed-summary__icon"><FolderGit2 size={23} /></div>
          <div><h3>{data.developed}</h3><p>Active on <code>{data.branch}</code> with durable workflow evidence retained for handoff and recovery.</p></div>
        </div>
        <div className="workflow-summary">
          <div><span>Workflow</span><Link to={`/projects/${data.id}/workflows/${data.workflowId}`}>{data.workflowName}<ArrowRight size={14} /></Link></div>
          <div><span>Active owner</span><strong>{data.role} · {data.model}</strong></div>
          <div><span>Completion</span><ProgressBar value={data.progress} tone={data.health === "offline" ? "red" : "teal"} /></div>
        </div>
      </section>
      <section className="section section--flat">
        <div className="section-heading"><div><span className="kicker">Source quality</span><h2>Monitoring coverage</h2></div><StatusBadge status={data.coverage} /></div>
        <div className="coverage-detail">
          <div><span className="label">Live process</span><strong>{data.live ? <><CheckCircle2 size={15} />Connected</> : <><CircleSlash2 size={15} />Unavailable</>}</strong></div>
          <div><span className="label">Last synchronized</span><strong><CalendarClock size={15} />{new Date(data.lastSync).toLocaleString()}</strong></div>
          <div><span className="label">Token accounting</span><strong>{data.coverage === "exact" ? "Reported by active sessions" : "Known values preserved; missing categories not estimated"}</strong></div>
        </div>
      </section>
    </div>

    <section className="section">
      <div className="section-heading"><div><span className="kicker">Durable record</span><h2>Development history</h2></div><span className="section-note">Newest first</span></div>
      <History events={data.history} />
    </section>
  </div>;
}
