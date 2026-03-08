// ---------------------------------------------------------------------------
// Timezone Utilities for Regional Energy Data
// ---------------------------------------------------------------------------

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
  const upperRegion = region.toUpperCase();
  return REGION_TIMEZONES[upperRegion] || "UTC";
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
