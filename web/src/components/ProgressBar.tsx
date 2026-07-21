export function ProgressBar({ value, tone = "teal", label }: { value: number; tone?: "teal" | "amber" | "red"; label?: string }) {
  return (
    <div className="progress-wrap" aria-label={label ?? `${value}%`}>
      <div className="progress"><span className={`progress__fill progress__fill--${tone}`} style={{ width: `${Math.min(100, value)}%` }} /></div>
      <span>{value}%</span>
    </div>
  );
}
