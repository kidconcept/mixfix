// ---------------------------------------------------------------------------
// Timezone Utilities for Regional Energy Data
// ---------------------------------------------------------------------------

import { getBATimezone } from "./config/balancing-authorities";

/**
 * Mapping of ISO/RTO regions to their IANA timezone identifiers
 */
export const REGION_TIMEZONES: Record<string, string> = {
  // Eastern Time
  NYISO: "America/New_York",
  NYIS: "America/New_York",
  ISONE: "America/New_York",
  ISNE: "America/New_York",
  PJM: "America/New_York", // PJM spans multiple zones, but Eastern is primary
  
  // Central Time
  ERCOT: "America/Chicago",
  ERCO: "America/Chicago",
  MISO: "America/Chicago", // MISO spans multiple zones, but Central is primary
  SPP: "America/Chicago",
  SWPP: "America/Chicago",
  
  // Pacific Time
  CAISO: "America/Los_Angeles",
  CISO: "America/Los_Angeles",
};

/**
 * Get the timezone for a given region
 */
export function getRegionTimezone(region: string | null): string {
  if (!region) return "UTC";

  // Allow direct IANA timezone strings (e.g. "America/Denver").
  if (region.includes("/")) return region;

  const upperRegion = region.toUpperCase();

  // Prefer explicit static ISO map first.
  if (REGION_TIMEZONES[upperRegion]) {
    return REGION_TIMEZONES[upperRegion];
  }

  // Fall back to BA config timezones for non-ISO BAs.
  return getBATimezone(upperRegion);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function parseLocalDate(date: string): { year: number; month: number; day: number } {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid local date format: ${date}`);
  }

  return {
    year: parseInt(match[1], 10),
    month: parseInt(match[2], 10),
    day: parseInt(match[3], 10),
  };
}

function getDateTimePartsInTimezone(date: Date, timezone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const value = (type: string) => parseInt(parts.find((p) => p.type === type)?.value || "0", 10);

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function zonedLocalDateTimeToUTC(date: string, timezone: string, hour = 0, minute = 0, second = 0): Date {
  const { year, month, day } = parseLocalDate(date);
  let utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  // Iteratively solve timezone offset (covers DST transitions reliably).
  for (let i = 0; i < 5; i++) {
    const local = getDateTimePartsInTimezone(utcGuess, timezone);
    const localAsUTC = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    const targetAsUTC = Date.UTC(year, month - 1, day, hour, minute, second);
    const deltaMs = localAsUTC - targetAsUTC;

    if (deltaMs === 0) break;
    utcGuess = new Date(utcGuess.getTime() - deltaMs);
  }

  return utcGuess;
}

function toEIAHourString(date: Date): string {
  const iso = date.toISOString();
  return iso.slice(0, 13);
}

export interface UTCDateWindow {
  startUTCISO: string;
  endUTCISO: string;
  startUTCHour: string;
  endUTCHour: string;
}

/**
 * Convert a local-date day window in a target timezone to UTC bounds.
 * Useful for building API query ranges where UI date is local to BA/ISO.
 */
export function getUTCWindowForLocalDate(
  date: string,
  regionOrTimezone: string | null,
  options?: {
    bufferBeforeHours?: number;
    bufferAfterHours?: number;
  }
): UTCDateWindow {
  const timezone = getRegionTimezone(regionOrTimezone);
  const bufferBefore = options?.bufferBeforeHours ?? 0;
  const bufferAfter = options?.bufferAfterHours ?? 0;

  const { year, month, day } = parseLocalDate(date);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0));
  const nextDayStr = `${nextDay.getUTCFullYear()}-${pad2(nextDay.getUTCMonth() + 1)}-${pad2(nextDay.getUTCDate())}`;

  const localMidnightUTC = zonedLocalDateTimeToUTC(date, timezone, 0, 0, 0);
  const nextLocalMidnightUTC = zonedLocalDateTimeToUTC(nextDayStr, timezone, 0, 0, 0);

  const start = new Date(localMidnightUTC.getTime() - bufferBefore * 60 * 60 * 1000);
  const end = new Date(nextLocalMidnightUTC.getTime() + bufferAfter * 60 * 60 * 1000);

  return {
    startUTCISO: start.toISOString(),
    endUTCISO: end.toISOString(),
    startUTCHour: toEIAHourString(start),
    endUTCHour: toEIAHourString(end),
  };
}

/**
 * Normalize EIA-style timestamps to a valid ISO-8601 UTC timestamp.
 * Supports inputs like:
 * - YYYY-MM-DDTHH
 * - YYYY-MM-DDTHH:mm:ss
 * - YYYY-MM-DDT24 (mapped to next day T00)
 */
function normalizeUTCTimestamp(input: string): Date | null {
  if (!input) return null;

  const trimmed = input.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})(?::(\d{2}))?(?::(\d{2}))?(Z)?$/);

  if (match) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);
    const hour = parseInt(match[4], 10);
    const minute = parseInt(match[5] || "0", 10);
    const second = parseInt(match[6] || "0", 10);

    if (hour === 24 && minute === 0 && second === 0) {
      const nextDay = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0));
      return Number.isNaN(nextDay.getTime()) ? null : nextDay;
    }

    if (hour >= 0 && hour <= 23) {
      // Treat no-suffix timestamps as UTC to match EIA hourly semantics.
      const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  }

  // Fallback for already-qualified ISO strings with offsets.
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Convert UTC timestamp to local hour for a given region
 */
export function convertUTCToLocalHour(utcTimestamp: string, region: string | null): number {
  const timezone = getRegionTimezone(region);
  const date = normalizeUTCTimestamp(utcTimestamp);
  if (!date) return 0;
  
  // Format the date in the target timezone and extract the hour
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
  });
  
  const localHour = parseInt(formatter.format(date), 10);
  return localHour;
}

/**
 * Convert UTC timestamp to local date string (YYYY-MM-DD) for a given region
 */
export function convertUTCToLocalDate(utcTimestamp: string, region: string | null): string {
  const timezone = getRegionTimezone(region);
  const date = normalizeUTCTimestamp(utcTimestamp);
  if (!date) return "";
  
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  
  const parts = formatter.formatToParts(date);
  const year = parts.find(p => p.type === "year")?.value;
  const month = parts.find(p => p.type === "month")?.value;
  const day = parts.find(p => p.type === "day")?.value;
  
  return `${year}-${month}-${day}`;
}

/**
 * Get timezone abbreviation (EST, CST, PST, etc.) for display
 */
export function getTimezoneAbbreviation(region: string | null, date: Date = new Date()): string {
  const timezone = getRegionTimezone(region);
  
  if (timezone === "UTC") return "UTC";
  
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "short",
  });
  
  const parts = formatter.formatToParts(date);
  const tzPart = parts.find(p => p.type === "timeZoneName");
  
  return tzPart?.value || timezone;
}
