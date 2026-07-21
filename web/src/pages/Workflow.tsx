import { ArrowLeft, ArrowRight, Bot, BrainCircuit, GitBranch, Layers3, Timer, UserRoundCog, Zap } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { History } from "../components/History";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { fallbacks, useApiData } from "../lib/data-context";
import { relativeTime, titleCase } from "../lib/format";
import type { WorkflowDetail } from "../types";

export function Workflow() {
  const { id = "workflow-030-dashboard", projectId } = useParams();
  const { data } = useApiData<WorkflowDetail>(`/api/workflows/${id}${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`, fallbacks.workflowMock);

  return <div className="page">
    <Link className="back-link" to={`/projects/${data.projectId}`}><ArrowLeft size={14} />{data.projectName}</Link>
    <PageHeader eyebrow={`Workflow · ${data.tier}`} title={data.name} description={data.objective} actions={<StatusBadge status={data.status} />} />

    <section className="workflow-facts" aria-label="Workflow facts">
      <div><span>Mode</span><strong>{data.mode}</strong></div>
      <div><span>Current phase</span><strong>{data.phase}</strong></div>
      <div><span>Branch</span><strong><GitBranch size={13} />{data.branch}</strong></div>
      <div><span>Started</span><strong>{relativeTime(data.startedAt)}</strong></div>
      <div><span>Last evidence</span><strong>{relativeTime(data.updatedAt)}</strong></div>
    </section>

    <section className="section phase-section">
        <div className="section-heading"><div><span className="kicker">Delivery path</span><h2>Workflow phases</h2></div><span className="section-note">Observed progression</span></div>
      <div className="phase-rail">{data.phases.map((phase, index) => <div className={`phase phase--${phase.status}`} key={phase.name}>
        <div className="phase__index">{phase.status === "complete" ? "✓" : index + 1}</div><div><strong>{phase.name}</strong><span>{titleCase(phase.status)}</span></div>
      </div>)}</div>
    </section>

    <section className="section">
      <div className="section-heading"><div><span className="kicker">Execution</span><h2>Tasks and evidence</h2></div><span className="section-note">{data.tasks.filter((t) => t.status === "complete").length} of {data.tasks.length} complete</span></div>
      <div className="table-scroll"><table className="data-table task-table"><thead><tr><th>Task</th><th>Status</th><th>Owner</th><th>Model</th><th>Effort</th><th>Elapsed</th><th>Evidence</th></tr></thead>
        <tbody>{data.tasks.map((task) => <tr key={task.id}><td><strong>{task.title}</strong></td><td><StatusBadge status={task.status} /></td><td><span className="role-label"><UserRoundCog size={14} />{task.role}</span></td><td><code>{task.model}</code></td><td>{titleCase(task.effort)}</td><td><span className="role-label"><Timer size={13} />{task.elapsed}</span></td><td><span className="evidence-cell">{task.evidence}</span></td></tr>)}</tbody>
      </table></div>
    </section>

    <section className="section">
      <div className="section-heading"><div><span className="kicker">Specialists</span><h2>Agent assignments</h2></div><Link className="text-link" to="/tokens">View token detail <Zap size={14} /></Link></div>
      <div className="assignment-grid">{data.assignments.map((assignment) => <div className={`assignment assignment--${assignment.status}`} key={assignment.role}>
        <div className="assignment__icon">{assignment.role === "planner" || assignment.role === "reviewer" ? <BrainCircuit size={18} /> : <Bot size={18} />}</div>
        <div><strong>{titleCase(assignment.role)}</strong><span>{assignment.model}</span>{assignment.assignmentId && <code>{assignment.assignmentId}</code>}</div>
        <StatusBadge status={assignment.status} />
      </div>)}</div>
    </section>

    <section className="section">
      <div className="section-heading"><div><span className="kicker">Audit trail</span><h2>Durable history</h2></div><Layers3 size={18} /></div>
      <History events={data.history} />
    </section>
    <div className="monitor-banner"><strong>Monitor-only workflow</strong><span>Approval, retry, reconciliation, and phase transitions remain in the coordinator runtime.</span><ArrowRight size={16} /></div>
  </div>;
}
