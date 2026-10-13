import type { ServerStatus } from "@/lib/types";

const SYMBOL: Record<ServerStatus, string> = { online: "●", offline: "●", unknown: "○" };
const COLOR: Record<ServerStatus, string> = { online: "green", offline: "red", unknown: "gray" };

export function StatusBadge({ status }: { status: ServerStatus }) {
  return (
    <span style={{ color: COLOR[status] }}>
      {SYMBOL[status]} {status}
    </span>
  );
}
