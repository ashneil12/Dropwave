import type { ScheduledTask } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  cadenceInWords,
  habitPromptFallback,
  timeInWords,
  whenFromSchedule,
  whenToSchedule,
} from "./DropwaveHabits.logic";

const gt = (message: string, vars?: Record<string, string | number>) =>
  message.replace(/\{(\w+)\}/g, (_match, key: string) => String(vars?.[key] ?? `{${key}}`));

const taskWith = (schedule: ScheduledTask["schedule"]) =>
  ({ schedule }) as Pick<ScheduledTask, "schedule">;

describe("timeInWords", () => {
  it("renders 24h times in words", () => {
    expect(timeInWords("09:00")).toBe("9am");
    expect(timeInWords("09:30")).toBe("9:30am");
    expect(timeInWords("17:00")).toBe("5pm");
    expect(timeInWords("00:15")).toBe("12:15am");
    expect(timeInWords("12:00")).toBe("12pm");
  });
});

describe("cadenceInWords", () => {
  it("renders intervals in words", () => {
    expect(cadenceInWords(taskWith({ type: "interval", everyMs: 3_600_000 }), gt)).toBe(
      "Every hour",
    );
    expect(cadenceInWords(taskWith({ type: "interval", everyMs: 86_400_000 }), gt)).toBe(
      "Every day",
    );
    expect(cadenceInWords(taskWith({ type: "interval", everyMs: 604_800_000 }), gt)).toBe(
      "Every week",
    );
    expect(cadenceInWords(taskWith({ type: "interval", everyMs: 10_800_000 }), gt)).toBe(
      "Every 3 hours",
    );
    expect(cadenceInWords(taskWith({ type: "interval", everyMs: 1_800_000 }), gt)).toBe(
      "Every 30 minutes",
    );
  });

  it("renders fixed-time cadences in words", () => {
    const at = (weekdays?: ReadonlyArray<number>) =>
      taskWith({ type: "fixed_time", timeOfDay: "09:00", weekdays });
    expect(cadenceInWords(at([0, 1, 2, 3, 4, 5, 6]), gt)).toBe("Every day at 9am");
    expect(cadenceInWords(at(undefined), gt)).toBe("Every day at 9am");
    expect(cadenceInWords(at([1, 2, 3, 4, 5]), gt)).toBe("Every weekday at 9am");
    expect(cadenceInWords(at([1]), gt)).toBe("Every Monday at 9am");
    expect(cadenceInWords(at([5]), gt)).toBe("Every Friday at 9am");
    expect(cadenceInWords(at([1, 5]), gt)).toBe("Weekly on Monday, Friday at 9am");
  });

  it("renders webhook and once schedules", () => {
    expect(cadenceInWords(taskWith({ type: "webhook", signature: null }), gt)).toBe(
      "When a webhook arrives",
    );
    expect(cadenceInWords(taskWith({ type: "once", runAt: "2026-01-01T09:00:00Z" }), gt)).toBe(
      "Runs once",
    );
  });
});

describe("whenToSchedule / whenFromSchedule", () => {
  it("round-trips every preset", () => {
    const presets = [
      { preset: "morning", time: "08:30", hours: 24 },
      { preset: "weekday", time: "17:00", hours: 24 },
      { preset: "monday", time: "09:00", hours: 24 },
      { preset: "hourly", time: "09:00", hours: 24 },
      { preset: "custom", time: "09:00", hours: 6 },
    ] as const;
    for (const when of presets) {
      const schedule = whenToSchedule(when);
      expect(whenFromSchedule(schedule)).toEqual(when);
    }
  });

  it("clamps custom hours to at least one", () => {
    expect(whenToSchedule({ preset: "custom", time: "09:00", hours: 0 })).toEqual({
      type: "interval",
      everyMs: 3_600_000,
    });
  });
});

describe("habitPromptFallback", () => {
  it("takes the first sentence", () => {
    expect(habitPromptFallback("Check the deploy status. Then report back.")).toBe(
      "Check the deploy status",
    );
  });

  it("clips to twelve words and strips trailing punctuation", () => {
    const prompt =
      "Every morning check the deploy pipeline for the billing service and email me a short summary of anything that failed overnight please";
    const result = habitPromptFallback(prompt);
    expect(result.split(" ").length).toBeLessThanOrEqual(12);
    expect(result).not.toMatch(/[.!?,;:]$/);
  });

  it("returns the whole prompt when it has no sentence end", () => {
    expect(habitPromptFallback("water the plants")).toBe("water the plants");
  });
});
