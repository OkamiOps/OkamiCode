import { Badge } from "@heroui/react";

type Status = "neutral" | "offline" | "online" | "warning";

interface StatusBadgeProps {
  label: string;
  status?: Status;
}

export function StatusBadge({ label, status = "neutral" }: StatusBadgeProps) {
  return (
    <Badge className="status-badge" data-status={status} variant="soft">
      <span className="status-badge__dot" aria-hidden="true" />
      <Badge.Label>{label}</Badge.Label>
    </Badge>
  );
}
