/**
 * Balancing Authority Configuration Loader
 * 
 * Central utility to load and access BA configuration including:
 * - All 75 EIA Balancing Authorities
 * - Zone lists for 7 ISOs with pricing
 * - Timezone, type, and metadata for each BA
 */

import baConfig from '../../../config/balancing-authorities.json';

export interface BAConfig {
  code: string;
  eiaCode: string;
  name: string;
  type: 'ISO' | 'Utility' | 'Regional';
  timezone: string;
  hasPricing: boolean;
  gridStatusDataset?: string;
  zones?: string[];
  representativeZone?: string;
}

type BAConfigMap = Record<string, BAConfig>;

// Load config at module initialization
const config: BAConfigMap = baConfig as BAConfigMap;

/**
 * Get all balancing authorities
 */
export function getAllBAs(): BAConfig[] {
  return Object.values(config);
}

/**
 * Get BAs with pricing support (ISOs)
 */
export function getBAsWithPricing(): BAConfig[] {
  return Object.values(config).filter(ba => ba.hasPricing);
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
 * Get zones for a BA (only ISOs have zones)
 */
export function getZones(code: string): string[] {
  const ba = getBAConfig(code);
  return ba?.zones ?? [];
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
 * Get all BA codes (for dropdown menus, etc.)
 */
export function getAllBACodes(): string[] {
  return Object.keys(config);
}

/**
 * Get ISOs only
 */
export function getISOs(): BAConfig[] {
  return Object.values(config).filter(ba => ba.type === 'ISO');
}
