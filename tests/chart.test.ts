import { describe, expect, it } from "vitest";
import { niceMax, niceMaxBytes, parseRange, runPath, segments, tempDomain } from "@/lib/chart";
import { formatTemp } from "@/lib/format";

describe("parseRange", () => {
  it("accepts the three ranges and defaults to 24h", () => {
    expect(parseRange("1h")).toBe("1h");
    expect(parseRange("7d")).toBe("7d");
    expect(parseRange(undefined)).toBe("24h");
    expect(parseRange("30d")).toBe("24h");
    expect(parseRange("<script>")).toBe("24h");
  });
});

describe("axis helpers", () => {
  it("niceMax rounds up to 1, 2, 5 or 10 times a power of ten", () => {
    expect(niceMax(0.7)).toBe(1);
    expect(niceMax(1.2)).toBe(2);
    expect(niceMax(3)).toBe(5);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(130)).toBe(200);
    expect(niceMax(0)).toBe(1);
    expect(niceMax(-5)).toBe(1);
  });

  it("niceMaxBytes stays on clean binary units", () => {
    expect(niceMaxBytes(300)).toBe(500);
    expect(niceMaxBytes(110 * 1024)).toBe(200 * 1024);
    expect(niceMaxBytes(3.2 * 1024 * 1024)).toBe(5 * 1024 * 1024);
  });

  it("tempDomain pads and never collapses", () => {
    expect(tempDomain([])).toEqual([0, 100]);
    expect(tempDomain([40, 60])).toEqual([37, 63]);
    const [lo, hi] = tempDomain([50, 50]);
    expect(hi - lo).toBeGreaterThanOrEqual(10);
    expect(lo).toBeLessThanOrEqual(50);
    expect(hi).toBeGreaterThanOrEqual(50);
  });

  it("formatTemp shows n/a for unavailable and keeps a real 0", () => {
    expect(formatTemp(null)).toBe("n/a");
    expect(formatTemp(undefined)).toBe("n/a");
    expect(formatTemp(52.4)).toBe("52°C");
    expect(formatTemp(0)).toBe("0°C");
  });
});

describe("segments", () => {
  const MIN = 60_000;
  const p = (minute: number, v: number | null) => ({ t: minute * MIN, v });

  it("keeps a continuous series as one run", () => {
    expect(segments([p(0, 1), p(1, 2), p(2, 3)], 2.5 * MIN)).toHaveLength(1);
  });

  it("breaks the line across an outage longer than the allowed gap", () => {
    const runs = segments([p(0, 1), p(1, 2), p(30, 3), p(31, 4)], 2.5 * MIN);
    expect(runs).toHaveLength(2);
    expect(runs[0].map((x) => x.v)).toEqual([1, 2]);
    expect(runs[1].map((x) => x.v)).toEqual([3, 4]);
  });

  it("breaks on unavailable (null) values and never treats null as zero", () => {
    const runs = segments([p(0, 5), p(1, null), p(2, 7)], 10 * MIN);
    expect(runs.map((r) => r.map((x) => x.v))).toEqual([[5], [7]]);
    expect(runs.flat().some((x) => x.v === 0)).toBe(false);
  });

  it("keeps a genuine zero", () => {
    expect(segments([p(0, 0), p(1, 0)], 5 * MIN)[0].map((x) => x.v)).toEqual([0, 0]);
  });

  it("returns nothing for an empty or all-null series", () => {
    expect(segments([], MIN)).toEqual([]);
    expect(segments([p(0, null), p(1, null)], MIN)).toEqual([]);
  });
});

describe("runPath", () => {
  const x = (t: number) => t;
  const y = (v: number) => 100 - v;

  it("builds a line and a closed area", () => {
    const run = [{ t: 0, v: 10 }, { t: 10, v: 20 }];
    expect(runPath(run, x, y, 100, false)).toBe("M0.00 90.00 L10.00 80.00");
    expect(runPath(run, x, y, 100, true)).toBe("M0.00 90.00 L10.00 80.00 L10.00 100 L0.00 100 Z");
  });

  it("draws a lone sample as a dot and gives it no area", () => {
    const run = [{ t: 5, v: 30 }];
    expect(runPath(run, x, y, 100, false)).toBe("M5.00 70.00 L5.01 70.00");
    expect(runPath(run, x, y, 100, true)).toBe("");
  });
});
