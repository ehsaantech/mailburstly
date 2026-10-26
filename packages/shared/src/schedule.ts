/**
 * Campaign scheduling rules and stop conditions.
 *
 * Everything in this file is a pure function of its arguments. That matters:
 * the scheduler runs these on every tick, and a rule that cannot be tested
 * in isolation is a rule that will silently send at 3am.
 *
 * Two concerns live here:
 *
 *   1. Send windows — when is the campaign allowed to send at all?
 *   2. Stop conditions — when should a lead stop being contacted?
 */

import type { ScheduleRule } from "./types.js";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export type ScheduleMode = "always" | "office_hours" | "custom";

export interface Schedule {
  mode?: ScheduleMode;
  rules?: ScheduleRule[];
}

export interface CampaignRules {
  schedule: Schedule | null | undefined;
  stopOnReply: boolean;
  stopOnAutoReply: boolean;
  stopForCompany: boolean;
  dailyMaxLeads: number | null;
}

/** Why a lead stopped being contacted. */
export type StopReason =
  | "replied"
  | "auto_replied"
  | "same_company"
  | "unsubscribed"
  | "out_of_office"
  | "bounced"
  | "manual";

/* -------------------------------------------------------------------------- */
/* Timezone helpers                                                            */
/* -------------------------------------------------------------------------- */

/** Wall-clock parts of an instant in a given timezone. */
export interface ZonedParts {
  /** 0 = Sunday … 6 = Saturday. */
  dayOfWeek: number;
  /** Minutes since midnight. */
  minutes: number;
  /** "HH:MM" for display. */
  time: string;
}

const DAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Reads the wall clock in `timeZone` without pulling in a date library.
 *
 * `Intl.DateTimeFormat` with an explicit `timeZone` is the one way to do
 * this correctly in every runtime, and it ships with the platform.
 */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";

  const weekday = DAY_INDEX[get("weekday")] ?? 0;
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute")) || 0;

  return {
    dayOfWeek: weekday,
    minutes: hour * 60 + minute,
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

/** Parses "HH:MM" into minutes since midnight. Returns null when malformed. */
export function parseTime(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/* -------------------------------------------------------------------------- */
/* Send windows                                                                */
/* -------------------------------------------------------------------------- */

/** Monday–Friday, 09:00–17:00. The default when a campaign says "office hours". */
const OFFICE_HOURS: ScheduleRule[] = [
  {
    daysOfWeek: [1, 2, 3, 4, 5],
    startTime: "09:00",
    endTime: "17:00",
  },
];

/**
 * Parses the `schedule` column into a typed schedule.
 *
 * The column is jsonb, so its contents are untrusted: a hand-edited row, an
 * older schema, or a bad API payload can put anything in it. Anything that
 * does not look like a schedule is treated as "no schedule", which means
 * "always send" — a corrupt schedule must not silently stop a campaign.
 */
export function parseSchedule(raw: unknown): Schedule | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const mode = obj.mode;
  if (mode !== "always" && mode !== "office_hours" && mode !== "custom") {
    return null;
  }

  if (mode !== "custom") return { mode };

  const rawRules = Array.isArray(obj.rules) ? obj.rules : [];
  const rules: ScheduleRule[] = [];

  for (const entry of rawRules) {
    if (!entry || typeof entry !== "object") continue;
    const rule = entry as Record<string, unknown>;

    const days = Array.isArray(rule.daysOfWeek)
      ? rule.daysOfWeek
          .map((d) => Number(d))
          .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      : [];

    if (days.length === 0) continue;

    const startTime = typeof rule.startTime === "string" ? rule.startTime : "00:00";
    const endTime = typeof rule.endTime === "string" ? rule.endTime : "23:59";
    if (parseTime(startTime) === null || parseTime(endTime) === null) continue;

    rules.push({
      daysOfWeek: days,
      startTime,
      endTime,
      timezone: typeof rule.timezone === "string" ? rule.timezone : undefined,
    });
  }

  return { mode: "custom", rules };
}

/**
 * The rules a schedule resolves to. An empty or unknown schedule means
 * "always" — a campaign that says nothing about timing must still send.
 */
export function resolveRules(
  schedule: Schedule | null | undefined,
  fallbackTimezone: string,
): ScheduleRule[] {  const mode = schedule?.mode ?? "always";

  if (mode === "always") return [];
  if (mode === "office_hours") {
    return OFFICE_HOURS.map((r) => ({ ...r, timezone: fallbackTimezone }));
  }

  const rules = schedule?.rules ?? [];
  return rules
    .map((rule) => ({
      ...rule,
      daysOfWeek: rule.daysOfWeek ?? [],
      startTime: rule.startTime ?? "00:00",
      endTime: rule.endTime ?? "23:59",
      timezone: rule.timezone ?? fallbackTimezone,
    }))
    .filter((rule) => rule.daysOfWeek.length > 0);
}

/**
 * True when the campaign is allowed to send at `now`.
 *
 * A window whose end is before its start spans midnight: 22:00–06:00 is a
 * valid overnight window, and "is 02:00 inside it?" must answer yes.
 */
export function isWithinSendWindow(
  schedule: Schedule | null | undefined,
  now: Date,
  fallbackTimezone = "UTC",
): boolean {
  const mode = schedule?.mode ?? "always";
  if (mode === "always") return true;

  const rules = resolveRules(schedule, fallbackTimezone);

  // A custom schedule whose rules are all invalid is a schedule that never
  // opens. Treating it as "always" would send around the clock because of a
  // typo, and the campaign would look healthy while doing it.
  if (mode === "custom" && rules.length === 0) return false;

  if (rules.length === 0) return true;

  for (const rule of rules) {
    const start = parseTime(rule.startTime);
    const end = parseTime(rule.endTime);
    if (start === null || end === null) continue;

    const zone = rule.timezone ?? fallbackTimezone;
    const parts = zonedParts(now, zone);
    const overnight = end <= start;

    if (!overnight) {
      if (rule.daysOfWeek.includes(parts.dayOfWeek)) {
        if (parts.minutes >= start && parts.minutes < end) return true;
      }
      continue;
    }

    // Overnight window. The evening half belongs to the day the window
    // opened, so check yesterday's weekday for the early-morning half.
    const previousDay = (parts.dayOfWeek + 6) % 7;
    if (parts.minutes >= start && rule.daysOfWeek.includes(parts.dayOfWeek)) {
      return true;
    }
    if (parts.minutes < end && rule.daysOfWeek.includes(previousDay)) {
      return true;
    }
  }

  return false;
}

/**
 * When the next window opens, so the scheduler can say "next send at 09:00"
 * instead of just "closed". Returns null for an always-open schedule.
 */
export function nextWindowOpen(
  schedule: Schedule | null | undefined,
  now: Date,
  fallbackTimezone = "UTC",
): Date | null {
  const rules = resolveRules(schedule, fallbackTimezone);
  if (rules.length === 0) return null;

  // Look ahead a week, minute by minute at 15-minute granularity. A week is
  // the longest gap a weekly window can have.
  const stepMinutes = 15;
  for (let offset = stepMinutes; offset <= 7 * 24 * 60; offset += stepMinutes) {
    const candidate = new Date(now.getTime() + offset * 60_000);
    if (isWithinSendWindow(schedule, candidate, fallbackTimezone)) {
      return candidate;
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Stop conditions                                                             */
/* -------------------------------------------------------------------------- */

/** What we know about a lead when deciding whether to stop it. */
export interface StopContext {
  /** The lead replied — a real human answered. */
  hasReply: boolean;
  /** The lead sent an automated out-of-office. */
  hasAutoReply: boolean;
  /** The lead asked to stop being contacted. */
  unsubscribed: boolean;
  /** The lead's address hard-bounced. */
  bounced: boolean;
  /** The lead's company was already contacted in this campaign. */
  companyAlreadyContacted: boolean;
  /** The lead is away until this instant. */
  oooUntil: Date | null;
}

export interface StopDecision {
  stop: boolean;
  reason: StopReason | null;
}

/**
 * Decides whether a lead must stop being contacted.
 *
 * The order matters. An unsubscribe outranks everything: it is a legal
 * obligation, not a heuristic. A hard bounce is next — that address does not
 * exist. Only then do the campaign's own rules apply.
 */
export function evaluateStopConditions(
  rules: CampaignRules,
  context: StopContext,
): StopDecision {
  if (context.unsubscribed) return { stop: true, reason: "unsubscribed" };
  if (context.bounced) return { stop: true, reason: "bounced" };

  if (rules.stopOnReply && context.hasReply) {
    return { stop: true, reason: "replied" };
  }

  if (rules.stopOnAutoReply && context.hasAutoReply) {
    return { stop: true, reason: "auto_replied" };
  }

  if (rules.stopForCompany && context.companyAlreadyContacted) {
    return { stop: true, reason: "same_company" };
  }

  return { stop: false, reason: null };
}

/**
 * Whether a lead may be contacted right now, taking the out-of-office window
 * into account. An out-of-office is a pause, not a stop: the lead stays in
 * the campaign and the sequence resumes when they are back.
 */
export function isLeadAvailable(
  context: StopContext,
  now: Date,
): { available: boolean; reason: StopReason | null } {
  if (context.oooUntil && context.oooUntil > now) {
    return { available: false, reason: "out_of_office" };
  }
  return { available: true, reason: null };
}

/**
 * How many new leads may still enter the campaign today.
 *
 * `dailyMaxLeads` caps new enrollments; when it is not set there is no cap
 * beyond the campaign's daily send limit.
 */
export function remainingNewLeadAllowance(
  dailyMaxLeads: number | null,
  newLeadsToday: number,
): number {
  if (dailyMaxLeads === null || dailyMaxLeads <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, dailyMaxLeads - newLeadsToday);
}
