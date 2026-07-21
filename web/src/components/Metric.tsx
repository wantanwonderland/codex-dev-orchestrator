import type { LucideIcon } from "lucide-react";

export function Metric({ label, value, detail, icon: Icon, tone = "neutral" }: { label: string; value: string | number; detail: string; icon: LucideIcon; tone?: string }) {
  return (
    <div className={`metric metric--${tone}`}>
      <div className="metric__icon"><Icon size={17} aria-hidden="true" /></div>
      <div>
        <div className="metric__label">{label}</div>
        <div className="metric__value">{value}</div>
        <div className="metric__detail">{detail}</div>
      </div>
    </div>
  );
}
