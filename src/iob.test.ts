import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";
import type { LogEntry } from "./logs";
import {
  DEFAULT_DURATION_MINUTES,
  DEFAULT_PEAK_MINUTES,
  formatDurationAgo,
  formatIobUnits,
  formatLastDoseLine,
  fractionRemaining,
  insulinOnBoard,
  lastNonBasalDose,
  validateIobSettings,
  type InsulinDose,
} from "./iob";
import { logToDose } from "./logs";

const PEAK = DEFAULT_PEAK_MINUTES;
const DIA = DEFAULT_DURATION_MINUTES;

function at(now: Date, minutesAgo: number): Date {
  return new Date(now.getTime() - minutesAgo * 60_000);
}

function dose(
  units: number,
  minutesAgo: number,
  now: Date,
  tag?: string
): InsulinDose {
  return { units, injectedAt: at(now, minutesAgo), tag };
}

describe("fractionRemaining — defaults (peak 75, duration 300)", () => {
  const table: Array<[number, number]> = [
    [0, 1.0],
    [30, 0.925],
    [60, 0.764],
    [75, 0.673],
    [90, 0.581],
    [120, 0.411],
    [150, 0.268],
    [180, 0.159],
    [210, 0.082],
    [240, 0.033],
    [270, 0.007],
    [300, 0.0],
  ];
  for (const [min, expected] of table) {
    it(`t=${min} ≈ ${expected}`, () => {
      expect(fractionRemaining(min, PEAK, DIA)).toBeCloseTo(expected, 3);
    });
  }
});

describe("fractionRemaining — duration 360 (params not hard-coded)", () => {
  const table: Array<[number, number]> = [
    [60, 0.779],
    [120, 0.45],
    [180, 0.208],
    [240, 0.073],
    [300, 0.014],
    [360, 0.0],
  ];
  for (const [min, expected] of table) {
    it(`t=${min} ≈ ${expected}`, () => {
      expect(fractionRemaining(min, PEAK, 360)).toBeCloseTo(expected, 3);
    });
  }
});

describe("fractionRemaining — edges and properties", () => {
  it("future, at duration, and far future are 0", () => {
    expect(fractionRemaining(-1)).toBe(0);
    expect(fractionRemaining(300)).toBe(0);
    expect(fractionRemaining(10_000)).toBe(0);
  });

  it("is strictly decreasing on [0, 300)", () => {
    for (let t = 0; t < 300; t++) {
      expect(fractionRemaining(t + 1)).toBeLessThan(fractionRemaining(t));
    }
  });

  it("largest 10-minute drop is in [70, 80] (the peak window)", () => {
    let maxDrop = -1;
    let maxK = -1;
    for (let k = 0; k <= 29; k++) {
      const drop =
        fractionRemaining(10 * k) - fractionRemaining(10 * k + 10);
      if (drop > maxDrop) {
        maxDrop = drop;
        maxK = k;
      }
    }
    expect(maxK).toBe(7); // [70, 80]
  });
});

describe("validateIobSettings", () => {
  it("rejects out-of-range peak and duration", () => {
    expect(() =>
      validateIobSettings({ peakMinutes: 40, durationMinutes: 300 })
    ).toThrow();
    expect(() =>
      validateIobSettings({ peakMinutes: 95, durationMinutes: 300 })
    ).toThrow();
    expect(() =>
      validateIobSettings({ peakMinutes: 75, durationMinutes: 200 })
    ).toThrow();
    expect(() =>
      validateIobSettings({ peakMinutes: 75, durationMinutes: 500 })
    ).toThrow();
  });

  it("accepts {peak: 90, duration: 240} (240 > 180)", () => {
    expect(() =>
      validateIobSettings({ peakMinutes: 90, durationMinutes: 240 })
    ).not.toThrow();
  });
});

describe("insulinOnBoard — scenarios", () => {
  const now = new Date("2026-09-06T12:00:00.000Z");

  it("none → 0.0", () => {
    expect(formatIobUnits(insulinOnBoard([], undefined, now))).toBe("0.0 u");
  });

  it("5 u, 0 min ago → 5.0", () => {
    expect(
      formatIobUnits(insulinOnBoard([dose(5, 0, now)], undefined, now))
    ).toBe("5.0 u");
  });

  it("4 u, 120 min ago → 1.6", () => {
    expect(
      formatIobUnits(insulinOnBoard([dose(4, 120, now)], undefined, now))
    ).toBe("1.6 u");
  });

  it("6 u at 180 min + 2 u at 30 min → 2.8", () => {
    expect(
      formatIobUnits(
        insulinOnBoard([dose(6, 180, now), dose(2, 30, now)], undefined, now)
      )
    ).toBe("2.8 u");
  });

  it("20 u tagged basal, 60 min ago → 0.0", () => {
    expect(
      formatIobUnits(
        insulinOnBoard([dose(20, 60, now, "basal")], undefined, now)
      )
    ).toBe("0.0 u");
  });

  it("3 u, 360 min ago → 0.0", () => {
    expect(
      formatIobUnits(insulinOnBoard([dose(3, 360, now)], undefined, now))
    ).toBe("0.0 u");
  });

  it("8 u with injectedAt 10 min in the future → 0.0", () => {
    expect(
      formatIobUnits(insulinOnBoard([dose(8, -10, now)], undefined, now))
    ).toBe("0.0 u");
  });

  it("4 u at 120 min ago, duration 360 → 1.8", () => {
    expect(
      formatIobUnits(
        insulinOnBoard(
          [dose(4, 120, now)],
          { peakMinutes: 75, durationMinutes: 360 },
          now
        )
      )
    ).toBe("1.8 u");
  });
});

describe("insulinOnBoard — invariants", () => {
  const now = new Date("2026-09-06T12:00:00.000Z");
  const sets: InsulinDose[][] = [
    [],
    [dose(5, 0, now)],
    [dose(4, 120, now), dose(2, 30, now), dose(18, 10, now, "basal")],
    [dose(6, 180, now), dose(2, 30, now), dose(3, 400, now)],
    [dose(8, -10, now), dose(1, 90, now)],
  ];

  it("never negative", () => {
    for (const doses of sets) {
      expect(insulinOnBoard(doses, undefined, now)).toBeGreaterThanOrEqual(0);
    }
  });

  it("never exceeds the sum of non-basal units within the window", () => {
    for (const doses of sets) {
      const cap = doses
        .filter((d) => d.tag !== "basal")
        .filter((d) => {
          const m = (now.getTime() - d.injectedAt.getTime()) / 60_000;
          return m >= 0 && m < DIA;
        })
        .reduce((s, d) => s + d.units, 0);
      expect(insulinOnBoard(doses, undefined, now)).toBeLessThanOrEqual(cap + 1e-9);
    }
  });

  it("adding a dose of u at exactly now increases the result by u", () => {
    const base = [dose(4, 60, now)];
    const before = insulinOnBoard(base, undefined, now);
    const after = insulinOnBoard([...base, dose(3, 0, now)], undefined, now);
    expect(after - before).toBeCloseTo(3, 6);
  });
});

describe("formatIobUnits", () => {
  it("one decimal, never -0.0", () => {
    expect(formatIobUnits(0)).toBe("0.0 u");
    expect(formatIobUnits(-0)).toBe("0.0 u");
    expect(formatIobUnits(2.34)).toBe("2.3 u");
    expect(formatIobUnits(2.35)).toBe("2.4 u");
    expect(formatIobUnits(0.0000001)).toBe("0.0 u");
  });
});

describe("last dose line", () => {
  const now = new Date("2026-09-06T12:00:00.000Z");

  it("picks the most recent non-basal in 24 h", () => {
    const last = lastNonBasalDose(
      [dose(18, 30, now, "basal"), dose(6, 110, now), dose(2, 20, now)],
      now
    );
    expect(last?.units).toBe(2);
  });

  it("hides doses older than 24 h and basal", () => {
    expect(
      lastNonBasalDose([dose(6, 25 * 60, now), dose(18, 10, now, "basal")], now)
    ).toBeNull();
  });

  it("formats like the spec", () => {
    expect(formatDurationAgo(110)).toBe("1 h 50 min ago");
    expect(formatLastDoseLine(dose(2.4, 110, now), now)).toBe(
      "Last dose 2.4 u · 1 h 50 min ago"
    );
    expect(formatLastDoseLine(dose(6, 20, now), now)).toBe(
      "Last dose 6 u · 20 min ago"
    );
  });
});

describe("logToDose adapter", () => {
  const now = new Date("2026-09-06T12:00:00.000Z");

  function entry(
    partial: Partial<LogEntry> & Pick<LogEntry, "id">
  ): LogEntry {
    return {
      note: "",
      carbs: null,
      insulinUnits: null,
      loggedAt: Timestamp.fromDate(now),
      tag: null,
      ...partial,
    };
  }

  it("missing tag counts as bolus", () => {
    const d = logToDose(entry({ id: "a", insulinUnits: 6, tag: null }));
    expect(d?.tag).toBeUndefined();
    expect(
      formatIobUnits(insulinOnBoard(d ? [d] : [], undefined, now))
    ).toBe("6.0 u");
  });

  it("tag basal is excluded", () => {
    const d = logToDose(
      entry({ id: "b", insulinUnits: 18, tag: "basal" })
    );
    expect(d?.tag).toBe("basal");
    expect(insulinOnBoard(d ? [d] : [], undefined, now)).toBe(0);
  });

  it("skips food-only, zero, and untimestamped rows", () => {
    expect(logToDose(entry({ id: "c", insulinUnits: null }))).toBeNull();
    expect(logToDose(entry({ id: "d", insulinUnits: 0 }))).toBeNull();
    expect(
      logToDose(entry({ id: "e", insulinUnits: 4, loggedAt: null }))
    ).toBeNull();
  });
});
