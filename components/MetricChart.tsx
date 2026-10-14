"use client";

import { useMemo, useRef, useState } from "react";
import { formatPercent, formatRate, formatTemp } from "@/lib/format";
import { niceMaxBytes, runPath, segments, tempDomain } from "@/lib/chart";

export type ChartSeries = { key: string; label: string; color: string; values: (number | null)[] };
type Kind = "percent" | "rate" | "temp";

const W = 600;
const H = 150;
const GRID = "#2c2c2a"; // hairline gridline (dark chart chrome)
const BASELINE = "#383835";

function fmt(kind: Kind, v: number | null): string {
  return kind === "percent" ? formatPercent(v) : kind === "rate" ? formatRate(v) : formatTemp(v);
}

function domainFor(kind: Kind, series: ChartSeries[]): [number, number] {
  const all = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  if (kind === "percent") return [0, 100];
  if (kind === "rate") return [0, niceMaxBytes((all.length ? Math.max(...all) : 0) * 1.05)];
  return tempDomain(all);
}

function tickLabel(kind: Kind, v: number): string {
  if (kind === "percent") return `${Math.round(v)}%`;
  if (kind === "rate") return formatRate(v).replace(".0 ", " ");
  return `${Math.round(v)}°`;
}

function when(t: number): string {
  return new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function MetricChart({
  title,
  kind,
  times,
  series,
  startMs,
  endMs,
  bucketMs,
  rangeLabel,
}: {
  title: string;
  kind: Kind;
  times: number[];
  series: ChartSeries[];
  startMs: number;
  endMs: number;
  bucketMs: number;
  rangeLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [tableOpen, setTableOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const [lo, hi] = useMemo(() => domainFor(kind, series), [kind, series]);
  const span = endMs - startMs || 1;
  const x = (t: number) => ((t - startMs) / span) * W;
  const y = (v: number) => H - ((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo || 1)) * H;
  const xPct = (t: number) => Math.min(100, Math.max(0, ((t - startMs) / span) * 100));
  const yPct = (v: number) => (y(v) / H) * 100;
  const ticks = [lo, lo + (hi - lo) / 2, hi];
  const showArea = series.length === 1;

  const paths = series.map((s) => {
    const runs = segments(
      times.map((t, i) => ({ t, v: s.values[i] })),
      bucketMs * 2.5
    );
    return {
      line: runs.map((r) => runPath(r, x, y, H, false)).join(" "),
      area: showArea ? runs.map((r) => runPath(r, x, y, H, true)).filter(Boolean).join(" ") : "",
    };
  });

  const lastIdx = series.map((s) => {
    for (let i = s.values.length - 1; i >= 0; i--) if (s.values[i] != null) return i;
    return -1;
  });

  function nearest(clientX: number): number | null {
    const el = box.current;
    if (!el || times.length === 0) return null;
    const rect = el.getBoundingClientRect();
    const t = startMs + ((clientX - rect.left) / (rect.width || 1)) * span;
    let best = 0;
    for (let i = 1; i < times.length; i++) if (Math.abs(times[i] - t) < Math.abs(times[best] - t)) best = i;
    return best;
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const cur = hover ?? times.length - 1;
    setHover(Math.min(times.length - 1, Math.max(0, cur + (e.key === "ArrowRight" ? 1 : -1))));
  }

  const hx = hover != null ? xPct(times[hover]) : 0;
  const summary = `${title} over the last ${rangeLabel}. ` + series.map((s) => {
    const i = lastIdx[series.indexOf(s)];
    return `${s.label} latest ${i >= 0 ? fmt(kind, s.values[i]) : "unavailable"}.`;
  }).join(" ");

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Legend with latest values">
          {series.map((s, si) => (
            <li key={s.key} className="flex items-center gap-1.5 text-zinc-300">
              <span className="inline-block h-0.5 w-3 rounded" style={{ background: s.color }} aria-hidden />
              <span className="text-muted">{s.label}</span>
              <span className="tabular-nums text-zinc-100">{lastIdx[si] >= 0 ? fmt(kind, s.values[lastIdx[si]]) : "n/a"}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3 flex gap-2">
        <div className="relative w-12 shrink-0 text-right text-[11px] tabular-nums text-muted" style={{ height: H }} aria-hidden>
          {ticks.map((t, i) => (
            <span key={i} className="absolute right-0 -translate-y-1/2" style={{ top: `${(y(t) / H) * 100}%` }}>
              {tickLabel(kind, t)}
            </span>
          ))}
        </div>

        <div
          ref={box}
          className="relative flex-1 touch-pan-y outline-offset-4 focus-visible:outline-2 focus-visible:outline-accent"
          style={{ height: H }}
          tabIndex={0}
          role="img"
          aria-label={summary}
          onPointerMove={(e) => setHover(nearest(e.clientX))}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover((h) => h ?? times.length - 1)}
          onBlur={() => setHover(null)}
          onKeyDown={onKey}
        >
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden>
            {ticks.map((t, i) => (
              <line key={i} x1={0} x2={W} y1={y(t)} y2={y(t)} stroke={i === 0 ? BASELINE : GRID} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            {series.map((s, si) => (
              <g key={s.key}>
                {paths[si].area && <path d={paths[si].area} fill={s.color} fillOpacity={0.1} stroke="none" />}
                <path
                  d={paths[si].line}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            ))}
          </svg>

          {/* Latest-value end dots, with a 2px surface ring. */}
          {hover == null &&
            series.map((s, si) => {
              const i = lastIdx[si];
              if (i < 0) return null;
              return (
                <span
                  key={s.key}
                  className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{ left: `${xPct(times[i])}%`, top: `${yPct(s.values[i] as number)}%`, background: s.color, boxShadow: "0 0 0 2px var(--color-surface)" }}
                  aria-hidden
                />
              );
            })}

          {hover != null && (
            <>
              <div className="pointer-events-none absolute inset-y-0 w-px bg-zinc-500/60" style={{ left: `${hx}%` }} aria-hidden />
              {series.map((s) =>
                s.values[hover] == null ? null : (
                  <span
                    key={s.key}
                    className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                    style={{ left: `${hx}%`, top: `${yPct(s.values[hover] as number)}%`, background: s.color, boxShadow: "0 0 0 2px var(--color-surface)" }}
                    aria-hidden
                  />
                )
              )}
              <div
                className="pointer-events-none absolute top-0 z-10 w-max max-w-56 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs shadow-lg"
                style={hx > 60 ? { right: `${100 - hx + 2}%` } : { left: `${hx + 2}%` }}
                role="status"
              >
                <div className="mb-1 text-muted">{when(times[hover])}</div>
                {series.map((s) => (
                  <div key={s.key} className="flex items-center gap-2">
                    <span className="inline-block h-0.5 w-3 rounded" style={{ background: s.color }} aria-hidden />
                    <span className="font-semibold tabular-nums text-zinc-100">{fmt(kind, s.values[hover])}</span>
                    <span className="text-muted">{s.label}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="ml-14 mt-1 flex justify-between text-[11px] text-muted" aria-hidden>
        <span>{rangeLabel} ago</span>
        <span>now</span>
      </div>

      <details className="mt-3" onToggle={(e) => setTableOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer text-xs text-muted hover:text-zinc-200">View as table</summary>
        {tableOpen && (
          <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-line">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-surface text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Time</th>
                  {series.map((s) => (
                    <th key={s.key} className="px-3 py-2 font-medium">{s.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[...times.keys()].reverse().map((i) => (
                  <tr key={times[i]}>
                    <td className="px-3 py-1.5 text-muted">{when(times[i])}</td>
                    {series.map((s) => (
                      <td key={s.key} className="px-3 py-1.5 tabular-nums text-zinc-200">{fmt(kind, s.values[i])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </div>
  );
}
