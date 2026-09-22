import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";
import type { Reading } from "./glucose";
import {
  formatTirPct,
  homeTirVisible,
  homeTirWindow,
  localDayStart,
  readingsInWindow,
  tirPercent,
} from "./tir";

function atLocal(
  y: number,
  month: number,
  day: number,
  h: number,
  min = 0
): Date {
  return new Date(y, month - 1, day, h, min, 0, 0);
}

function reading(valueMgdl: number, ms: number): Reading {
  return {
    valueMgdl,
    trend: "Flat",
    isHigh: false,
    isLow: false,
    measuredAt: Timestamp.fromMillis(ms),
    ingestedAt: Timestamp.fromMillis(ms),
  };
}

describe("tirPercent", () => {
  it("counts 70 and 180 as in range; 69 and 181 as not", () => {
    expect(tirPercent([{ valueMgdl: 70 }])).toBe(100);
    expect(tirPercent([{ valueMgdl: 180 }])).toBe(100);
    expect(tirPercent([{ valueMgdl: 69 }])).toBe(0);
    expect(tirPercent([{ valueMgdl: 181 }])).toBe(0);
  });

  it("3 in-range of 4 → 75%", () => {
    expect(
      tirPercent([
        { valueMgdl: 80 },
        { valueMgdl: 100 },
        { valueMgdl: 160 },
        { valueMgdl: 200 },
      ])
    ).toBe(75);
  });

  it("empty → null, not 0%", () => {
    expect(tirPercent([])).toBeNull();
  });

  it("rounds to a whole percent", () => {
    // 1/3 → 33%
    expect(
      tirPercent([{ valueMgdl: 100 }, { valueMgdl: 50 }, { valueMgdl: 50 }])
    ).toBe(33);
    expect(formatTirPct(72)).toBe("72%");
  });
});

describe("homeTirVisible", () => {
  it("hides 02:00–08:00, shows the rest", () => {
    expect(homeTirVisible(atLocal(2026, 9, 8, 7, 59))).toBe(false);
    expect(homeTirVisible(atLocal(2026, 9, 8, 8, 0))).toBe(true);
    expect(homeTirVisible(atLocal(2026, 9, 8, 23, 59))).toBe(true);
    expect(homeTirVisible(atLocal(2026, 9, 8, 1, 59))).toBe(true);
    expect(homeTirVisible(atLocal(2026, 9, 8, 2, 0))).toBe(false);
    expect(homeTirVisible(atLocal(2026, 9, 8, 5, 0))).toBe(false);
  });
});

describe("homeTirWindow", () => {
  it("08:00 Monday → Monday 00:00, caption today", () => {
    const now = atLocal(2026, 9, 7, 8, 0); // Mon
    const w = homeTirWindow(now);
    expect(w).not.toBeNull();
    expect(w!.startMs).toBe(localDayStart(now).getTime());
    expect(w!.caption).toBe("today");
  });

  it("01:00 Tuesday → Monday 00:00, caption since yesterday", () => {
    const now = atLocal(2026, 9, 8, 1, 0); // Tue
    const w = homeTirWindow(now);
    expect(w).not.toBeNull();
    const monday = atLocal(2026, 9, 7, 0, 0);
    expect(w!.startMs).toBe(monday.getTime());
    expect(w!.caption).toBe("since yesterday 12:00am");
    expect(w!.endMs - w!.startMs).toBe(25 * 60 * 60 * 1000);
  });

  it("01:59 Tuesday window is ~26h", () => {
    const now = atLocal(2026, 9, 8, 1, 59);
    const w = homeTirWindow(now)!;
    const hours = (w.endMs - w.startMs) / 3_600_000;
    expect(hours).toBeCloseTo(25 + 59 / 60, 5);
  });

  it("08:00 Tuesday restarts at Tuesday 00:00", () => {
    const now = atLocal(2026, 9, 8, 8, 0);
    const w = homeTirWindow(now)!;
    expect(w.startMs).toBe(atLocal(2026, 9, 8, 0, 0).getTime());
    expect(w.caption).toBe("today");
  });

  it("02:00–07:59 → null", () => {
    expect(homeTirWindow(atLocal(2026, 9, 8, 2, 0))).toBeNull();
    expect(homeTirWindow(atLocal(2026, 9, 8, 5, 30))).toBeNull();
  });
});

describe("readingsInWindow", () => {
  it("keeps points on the inclusive bounds", () => {
    const start = atLocal(2026, 9, 8, 0, 0).getTime();
    const end = atLocal(2026, 9, 8, 8, 0).getTime();
    const rs = [
      reading(100, start - 1),
      reading(110, start),
      reading(120, end),
      reading(130, end + 1),
    ];
    const inside = readingsInWindow(rs, start, end);
    expect(inside.map((r) => r.valueMgdl)).toEqual([110, 120]);
  });
});
