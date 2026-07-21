import { Activity, ArrowDownToLine, BrainCircuit, ChevronLeft, ChevronRight, Database, Gauge, Layers3, Search, Unplug, Zap } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { EmptyState } from "../components/EmptyState";
import { Metric } from "../components/Metric";
import { PageHeader } from "../components/PageHeader";
import { ProgressBar } from "../components/ProgressBar";
import { RateLimits } from "../components/RateLimits";
import { StatusBadge } from "../components/StatusBadge";
import { fallbacks, useApiData } from "../lib/data-context";
import { formatNumber, formatTokens, relativeTime, titleCase } from "../lib/format";
import type { Coverage, TokenData } from "../types";

const coverageOptions: Array<Coverage | "all"> = ["all", "exact", "backfilled", "partial", "offline"];
const PAGE_SIZE = 100;

export function Tokens() {
  const { data } = useApiData<TokenData>("/api/tokens", fallbacks.tokenMock);
  const [coverage, setCoverage] = useState<Coverage | "all">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => data.records.filter((record) => (coverage === "all" || record.coverage === coverage) && `${record.project} ${record.workflow} ${record.role} ${record.model}`.toLowerCase().includes(search.toLowerCase())), [coverage, data.records, search]);
  useEffect(() => setPage(0), [coverage, search]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totals = useMemo(() => data.records.reduce((acc, record) => ({ input: acc.input + (record.input ?? 0), cached: acc.cached + (record.cached ?? 0), output: acc.output + (record.output ?? 0), reasoning: acc.reasoning + (record.reasoning ?? 0), total: acc.total + record.total, allocated: acc.allocated + record.allocated }), { input: 0, cached: 0, output: 0, reasoning: 0, total: 0, allocated: 0 }), [data.records]);
  const unallocated = totals.total - totals.allocated;
  const allocatedPercent = totals.total ? Math.round((totals.allocated / totals.total) * 100) : 0;

  return <div className="page">
    <PageHeader eyebrow="Usage accounting" title="Tokens" description="Observed model usage, attribution quality, and rate-limit pressure across projects." />
    <section className="metric-grid token-metrics">
      <Metric label="Input" value={formatTokens(totals.input)} detail={`${formatTokens(totals.cached)} cached input`} icon={ArrowDownToLine} />
      <Metric label="Output" value={formatTokens(totals.output)} detail="Model responses" icon={Activity} tone="teal" />
      <Metric label="Reasoning" value={formatTokens(totals.reasoning)} detail="Known reasoning usage" icon={BrainCircuit} tone="amber" />
      <Metric label="Total observed" value={formatTokens(totals.total)} detail={`${data.records.length} usage records`} icon={Zap} />
    </section>

    <div className="split-band allocation-band">
      <section className="section section--flat">
        <div className="section-heading"><div><span className="kicker">Attribution</span><h2>Allocated vs unallocated</h2></div><Database size={18} /></div>
        <div className="allocation-layout">
          <div className="allocation-ring" style={{ "--allocation": `${allocatedPercent * 3.6}deg` } as CSSProperties}><div><strong>{allocatedPercent}%</strong><span>allocated</span></div></div>
          <div className="allocation-legend"><div><i className="dot dot--teal"/><span>Allocated</span><strong>{formatTokens(totals.allocated)}</strong></div><div><i className="dot dot--gray"/><span>Unallocated</span><strong>{formatTokens(unallocated)}</strong></div><p>Unallocated usage is observed but cannot be assigned confidently to a workflow.</p></div>
        </div>
      </section>
      <section className="section section--flat">
        <div className="section-heading"><div><span className="kicker">Capacity</span><h2>Rate limits</h2></div><Gauge size={18} /></div>
        <RateLimits limits={data.rateLimits} />
      </section>
    </div>

    <section className="section">
      <div className="section-heading section-heading--filters"><div><span className="kicker">Source quality</span><h2>Usage detail</h2></div><div className="filters"><label className="search-field"><Search size={14} /><span className="sr-only">Search usage</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search project or model" /></label><div className="segmented" aria-label="Coverage filter">{coverageOptions.map((option) => <button className={coverage === option ? "active" : ""} onClick={() => setCoverage(option)} key={option}>{titleCase(option)}</button>)}</div></div></div>
      <div className="coverage-legend"><span><StatusBadge status="exact" /> Session-reported</span><span><StatusBadge status="backfilled" /> Reconstructed</span><span><StatusBadge status="partial" /> Categories missing</span><span><StatusBadge status="offline" /> Last known snapshot</span></div>
      {filtered.length ? <div className="table-scroll"><table className="data-table token-table"><thead><tr><th>Project / workflow</th><th>Role / model</th><th>Input</th><th>Cached</th><th>Output</th><th>Reasoning</th><th>Total</th><th>Allocated</th><th>Coverage</th><th>Observed</th></tr></thead><tbody>{visible.map((record) => <tr key={record.id}>
        <td><strong>{record.project}</strong><span>{record.workflow}</span></td><td><strong>{record.role}</strong><code>{record.model}</code></td><td>{formatNumber(record.input)}</td><td>{formatNumber(record.cached)}</td><td>{formatNumber(record.output)}</td><td>{formatNumber(record.reasoning)}</td><td><strong>{formatNumber(record.total)}</strong></td><td><ProgressBar value={record.total ? Math.round(record.allocated / record.total * 100) : 0} /></td><td><StatusBadge status={record.coverage} /></td><td>{relativeTime(record.observedAt)}</td>
      </tr>)}</tbody></table></div> : <EmptyState title="No usage records" detail="Adjust the coverage filter or search term." />}
      <div className="table-footer"><span><Layers3 size={13} />{filtered.length} of {data.records.length} records</span><div className="pagination"><button className="icon-button" aria-label="Previous token page" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}><ChevronLeft size={15} /></button><span>Page {page + 1} of {pageCount}</span><button className="icon-button" aria-label="Next token page" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}><ChevronRight size={15} /></button></div><span><Unplug size={13} />Unavailable categories are never converted to zero</span></div>
    </section>
  </div>;
}
