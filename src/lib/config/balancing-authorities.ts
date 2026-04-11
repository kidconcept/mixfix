/**
 * Balancing Authority Configuration Loader
 * 
 * Central utility to load and access BA configuration including:
 * - All 75 EIA Balancing Authorities
 * - Zone lists for 7 ISOs with pricing
 * - Timezone, type, and metadata for each BA
 */

import baConfig from '../../../config/balancing-authorities.json';
import zoneBoundaries from '../../../config/zone-boundaries.json';

export interface BAConfig {
  code: string;
  eiaCode: string;
  name: string;
  type: 'ISO' | 'Utility' | 'Regional';
  timezone: string;
  hasPricing: boolean;
  gridStatusDataset?: string;
  gridStatusSPPDataset?: string;
  zones?: string[];
  representativeZone?: string;
}

export interface ZoneBoundary {
  zone: string;
  name: string;
  bounds: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  };
}

export interface ZoneInfo {
  code: string;
  name: string;
}

type BAConfigMap = Record<string, BAConfig>;

interface ISOZoneBoundaries {
  zones: ZoneBoundary[];
}

// Load config at module initialization
const config: BAConfigMap = baConfig as BAConfigMap;
const boundaries: Record<string, ISOZoneBoundaries> = zoneBoundaries as Record<string, ISOZoneBoundaries>;

/**
 * Get all balancing authorities
 */
export function getAllBAs(): BAConfig[] {
  return Object.values(config);
}

/**
 * Get BA config by code (supports both common and EIA codes)
 */
export function getBAConfig(code: string): BAConfig | undefined {
  // Try direct lookup first
  if (config[code]) {
    return config[code];
  }
  
  // Try looking up by EIA code
  return Object.values(config).find(ba => ba.eiaCode === code);
}

/**
 * Get EIA code for a BA (for API queries)
 */
export function getEIACode(code: string): string | undefined {
  const ba = getBAConfig(code);
  return ba?.eiaCode;
}

/**
 * Check if a BA has pricing data available
 */
export function hasPricingData(code: string): boolean {
  const ba = getBAConfig(code);
  return ba?.hasPricing ?? false;
}

/**
 * Get representative zone for a BA (for default selection)
 */
export function getRepresentativeZone(code: string): string | undefined {
  const ba = getBAConfig(code);
  return ba?.representativeZone;
}

/**
 * Get Grid Status dataset for a BA (only ISOs)
 */
export function getGridStatusDataset(code: string): string | undefined {
  const ba = getBAConfig(code);
  return ba?.gridStatusDataset;
}

/**
 * Get Grid Status SPP dataset for a BA (ERCOT only)
 */
export function getGridStatusSPPDataset(code: string): string | undefined {
  const ba = getBAConfig(code);
  return ba?.gridStatusSPPDataset;
}

/**
 * Get zone information with code and name
 */
export function getZonesWithNames(baCode: string): ZoneInfo[] {
  const ba = getBAConfig(baCode);
  if (!ba?.zones) return [];
  
  const isoBoundaries = boundaries[baCode];
  if (!isoBoundaries) {
    // If no boundary data, return zones with code as name
    return ba.zones.map(code => ({ code, name: code }));
  }
  
  // Map zone codes to their names from boundaries
  return ba.zones.map(code => {
    const zoneBoundary = isoBoundaries.zones.find(z => z.zone === code);
    return {
      code,
      name: zoneBoundary?.name || code
    };
  });
}

/**
 * Get zone name for a specific zone code
 */
export function getZoneName(baCode: string, zoneCode: string): string | undefined {
  const isoBoundaries = boundaries[baCode];
  if (!isoBoundaries) return zoneCode;
  
  const zoneBoundary = isoBoundaries.zones.find(z => z.zone === zoneCode);
  return zoneBoundary?.name || zoneCode;
}

export function isValidIANATimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function getBATimezone(code: string): string {
  const ba = getBAConfig(code);
  if (!ba?.timezone) return "UTC";

  // Hard guard against malformed timezone values in config.
  return isValidIANATimezone(ba.timezone) ? ba.timezone : "UTC";
}

const IANA_TO_EIA_TIMEZONE: Record<string, string> = {
  "America/New_York": "Eastern",
  "America/Chicago": "Central",
  "America/Denver": "Mountain",
  "America/Los_Angeles": "Pacific",
  "America/Phoenix": "Arizona",
};

/**
 * Map a BA's IANA timezone to the EIA daily endpoint's timezone facet value.
 * The EIA daily endpoint returns one row per timezone per fuel type per day,
 * so filtering to the correct timezone is mandatory to avoid 5x duplicate rows.
 */
export function getEIATimezone(code: string): string {
  const iana = getBATimezone(code);
  return IANA_TO_EIA_TIMEZONE[iana] ?? "Eastern";
}


