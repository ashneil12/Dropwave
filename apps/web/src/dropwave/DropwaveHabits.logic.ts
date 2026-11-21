import type { ScheduledTask, ScheduledTaskUpsertSchedule } from "@t3tools/contracts";

export type HabitPreset = "morning" | "weekday" | "monday" | "hourly" | "custom";

export interface HabitWhen {
  readonly preset: HabitPreset;
  /** "HH:MM" for fixed-time presets. */
  readonly time: string;
  /** Interval hours for the custom preset. */
  readonly hours: number;
}

type GtFn = (message: string, vars?: Record<string, string | number>) => string;

const weekdayGtName = (gt: GtFn, day: number): string => {
  switch (day) {
    case 0:
      return gt("Sunday");
    case 1:
      return gt("Monday");
    case 2:
      return gt("Tuesday");
    case 3:
      return gt("Wednesday");
    case 4:
      return gt("Thursday");
    case 5:
      return gt("Friday");
    default:
      return gt("Saturday");
  }
};

/** "09:00" → "9am", "09:30" → "9:30am", "17:00" → "5pm". */
export function timeInWords(timeOfDay: string): string {
  const [hourRaw, minuteRaw] = timeOfDay.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw ?? "0");
  if (!Number.isFinite(hour)) return timeOfDay;
  const suffix = hour < 12 ? "am" : "pm";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return minute === 0
    ? `${displayHour}${suffix}`
    : `${displayHour}:${String(minute).padStart(2, "0")}${suffix}`;
}

/** Cadence in plain words for a card, e.g. "Every weekday at 9am". */
export function cadenceInWords(task: Pick<ScheduledTask, "schedule">, gt: GtFn): string {
  const schedule = task.schedule;
  if (schedule.type === "interval") {
    const hours = schedule.everyMs / 3_600_000;
    if (hours === 1) return gt("Every hour");
    if (hours === 24) return gt("Every day");
    if (hours === 168) return gt("Every week");
    if (hours > 1 && Number.isInteger(hours)) return gt("Every {h} hours", { h: hours });
    const minutes = Math.max(1, Math.round(schedule.everyMs / 60_000));
    return gt("Every {m} minutes", { m: minutes });
  }
  if (schedule.type === "fixed_time") {
    const time = timeInWords(schedule.timeOfDay);
    const days = schedule.weekdays;
    if (days === undefined || days.length === 0 || days.length === 7) {
      return gt("Every day at {time}", { time });
    }
    if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) {
      return gt("Every weekday at {time}", { time });
    }
    if (days.length === 1) {
      const name = weekdayGtName(gt, days[0] ?? 0);
      return gt("Every {day} at {time}", { day: name, time });
    }
    return gt("Weekly on {days} at {time}", {
      days: days.map((d) => weekdayGtName(gt, d)).join(", "),
      time,
    });
  }
  if (schedule.type === "webhook") return gt("When a webhook arrives");
  return gt("Runs once");
}

/** Preset + time picker → the schedule written on save. */
export function whenToSchedule(when: HabitWhen): ScheduledTaskUpsertSchedule {
  switch (when.preset) {
    case "hourly":
      return { type: "interval", everyMs: 60 * 60 * 1000 };
    case "morning":
      return { type: "fixed_time", timeOfDay: when.time, weekdays: [0, 1, 2, 3, 4, 5, 6] };
    case "weekday":
      return { type: "fixed_time", timeOfDay: when.time, weekdays: [1, 2, 3, 4, 5] };
    case "monday":
      return { type: "fixed_time", timeOfDay: when.time, weekdays: [1] };
    case "custom":
      return { type: "interval", everyMs: Math.max(1, when.hours) * 60 * 60 * 1000 };
  }
}

/** Best preset match for an existing schedule, for the edit sheet. */
export function whenFromSchedule(
  schedule: ScheduledTask["schedule"] | ScheduledTaskUpsertSchedule,
): HabitWhen {
  if (schedule.type === "interval") {
    const hours = schedule.everyMs / 3_600_000;
    if (hours === 1) return { preset: "hourly", time: "09:00", hours: 24 };
    return { preset: "custom", time: "09:00", hours: Number.isInteger(hours) ? hours : 24 };
  }
  if (schedule.type === "fixed_time") {
    const days = schedule.weekdays ?? [];
    const time = /^\d{2}:\d{2}/.test(schedule.timeOfDay) ? schedule.timeOfDay.slice(0, 5) : "09:00";
    if (days.length === 1 && days[0] === 1) return { preset: "monday", time, hours: 24 };
    if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) {
      return { preset: "weekday", time, hours: 24 };
    }
    return { preset: "morning", time, hours: 24 };
  }
  return { preset: "custom", time: "09:00", hours: 24 };
}

/** Display fallback for tasks saved before summaries existed: first sentence, ≤12 words. */
export function habitPromptFallback(prompt: string): string {
  const flat = prompt.replace(/\s+/g, " ").trim();
  const sentence = /^.*?[.!?](?=\s|$)/.exec(flat)?.[0] ?? flat;
  return sentence
    .split(" ")
    .filter(Boolean)
    .slice(0, 12)
    .join(" ")
    .replace(/[.!?,;:]+$/, "")
    .trim();
}
