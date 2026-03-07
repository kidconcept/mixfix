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
 * Convert UTC timestamp to local hour for a given region
 */
export function convertUTCToLocalHour(utcTimestamp: string, region: string | null): number {
  const timezone = getRegionTimezone(region);
  const date = new Date(utcTimestamp);
  
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
  const date = new Date(utcTimestamp);
  
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
