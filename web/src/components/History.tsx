import { FileCheck2 } from "lucide-react";
import { relativeTime } from "../lib/format";
import type { HistoryEvent } from "../types";
import { StatusBadge } from "./StatusBadge";

export function History({ events }: { events: HistoryEvent[] }) {
  return (
    <div className="history-list">
      {events.map((event) => (
        <div className="history-row" key={event.id}>
          <div className={`history-row__mark history-row__mark--${event.outcome}`}><FileCheck2 size={14} /></div>
          <div className="history-row__content">
            <div className="history-row__title"><strong>{event.event}</strong><StatusBadge status={event.outcome} /></div>
            <div className="history-row__meta"><span>{event.actor}</span><span>{event.evidence}</span></div>
          </div>
          <time title={new Date(event.at).toLocaleString()}>{relativeTime(event.at)}</time>
        </div>
      ))}
    </div>
  );
}
