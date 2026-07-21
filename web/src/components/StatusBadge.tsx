import { CheckCircle2, CircleDashed, CircleDot, CloudOff, TriangleAlert, XCircle } from "lucide-react";
import { titleCase } from "../lib/format";

const icons = {
  healthy: CheckCircle2,
  success: CheckCircle2,
  complete: CheckCircle2,
  exact: CheckCircle2,
  active: CircleDot,
  live: CircleDot,
  executing: CircleDot,
  running: CircleDot,
  warning: TriangleAlert,
  reviewing: CircleDashed,
  queued: CircleDashed,
  backfilled: CircleDashed,
  partial: TriangleAlert,
  critical: XCircle,
  blocked: XCircle,
  offline: CloudOff,
  idle: CircleDashed,
  unavailable: CloudOff,
  scanning: CircleDashed,
  info: CircleDot,
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const key = status.toLowerCase() as keyof typeof icons;
  const Icon = icons[key] ?? CircleDashed;
  return (
    <span className={`status status--${key.replaceAll(" ", "-")}`}>
      <Icon aria-hidden="true" size={12} />
      {label ?? titleCase(status)}
    </span>
  );
}
