import { Clock3, TrendingDown, TrendingUp } from "lucide-react";
import type { RateLimit } from "../types";
import { ProgressBar } from "./ProgressBar";

export function RateLimits({ limits }: { limits: RateLimit[] }) {
  return <div className="rate-list">
    {limits.map((limit) => {
      const Trend = limit.trend > 0 ? TrendingUp : TrendingDown;
      const tone = limit.status === "critical" ? "red" : limit.status === "warning" ? "amber" : "teal";
      return <div className="rate-row" key={limit.name}>
        <div className="rate-row__title"><strong>{limit.name}</strong><span className={`trend trend--${limit.status}`}><Trend size={13} /> {Math.abs(limit.trend)}% this period</span></div>
        <ProgressBar value={limit.used} tone={tone} />
        <div className="rate-row__reset"><Clock3 size={13} />Resets {new Date(limit.resetAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}</div>
      </div>;
    })}
  </div>;
}
