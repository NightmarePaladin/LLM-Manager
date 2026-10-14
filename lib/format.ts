export const UNAVAILABLE = "n/a";

export function formatPercent(v: number | null | undefined): string {
  return v == null ? UNAVAILABLE : `${v.toFixed(1)}%`;
}

export function formatTemp(v: number | null | undefined): string {
  return v == null ? UNAVAILABLE : `${v.toFixed(0)}°C`;
}

export function formatBytes(v: number | null | undefined): string {
  if (v == null) return UNAVAILABLE;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = v;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatRate(bytesPerSecond: number | null | undefined): string {
  return bytesPerSecond == null ? UNAVAILABLE : `${formatBytes(bytesPerSecond)}/s`;
}

export function formatAge(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function formatUptime(seconds: number | null | undefined): string {
  if (seconds == null) return UNAVAILABLE;
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Wall clock, isolated here so Server Components stay lint-pure. */
export function nowMs(): number {
  return Date.now();
}
