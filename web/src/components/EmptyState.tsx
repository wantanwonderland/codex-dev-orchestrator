import { SearchX } from "lucide-react";

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><SearchX size={22} /><strong>{title}</strong><span>{detail}</span></div>;
}
