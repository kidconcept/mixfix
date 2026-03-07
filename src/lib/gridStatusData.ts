import { EnergySource, HistoricalRecord } from "@/types/energy";
import { convertUTCToLocalHour, convertUTCToLocalDate } from "./timezone";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GRID_STATUS_BASE = "https://api.gridstatus.io/v1";

// Mapping ISO names to Grid Status dataset IDs
const ISO_DATASET_MAP: Record<string, string> = {
  NYISO: "nyiso_fuel_mix",
  NYIS: "nyiso_fuel_mix",
  CAISO: "caiso_fuel_mix",
  CISO: "caiso_fuel_mix",
  ERCOT: "ercot_fuel_mix",
  ERCO: "ercot_fuel_mix",
  ISONE: "isone_fuel_mix",
  ISNE: "isone_fuel_mix",
  MISO: "miso_fuel_mix",
  PJM: "pjm_fuel_mix",
  SPP: "spp_fuel_mix",
  SWPP: "spp_fuel_mix",
};

// ---------------------------------------------------------------------------
// Grid Status API Types
// ---------------------------------------------------------------------------

interface GridStatusDataPoint {
  interval_start_utc: string;
  interval_end_utc: string;
  [key: string]: number | string; // Dynamic fuel type fields
}

interface GridStatusResponse {
  status_code: number;
  data: GridStatusDataPoint[];
  meta: {
    page: number;
    hasNextPage: boolean;
  };
}

// ---------------------------------------------------------------------------
// Fuel Type Mapping Functions
// ---------------------------------------------------------------------------

/**
 * Map Grid Status fuel types to our standard EnergySource types.
 * Different ISOs may have different fuel type names.
 * Updated to support 12 fuel types (8 renewables + 4 consumables).
 */
function mapGridStatusFuels(dataPoint: GridStatusDataPoint): Record<EnergySource, number> {
  const result: Record<EnergySource, number> = {
    // Renewables (8)
    solar: 0,
    wind: 0,
    hydro: 0,
    geothermal: 0,
    biomass: 0,
    batteries: 0,
    imports: 0,
    other: 0,
    // Consumables (4)
    coal: 0,
    gas: 0,
    oil: 0,
    nuclear: 0,
  };

  // Universal mapping - handles all ISOs
  for (const [key, value] of Object.entries(dataPoint)) {
    if (typeof value !== 'number') continue;
    
    const numValue = value as number;
    const lowerKey = key.toLowerCase();

    // Solar
    if (lowerKey === 'solar' || lowerKey === 'sun') {
      result.solar += numValue;
    }
    // Wind
    else if (lowerKey === 'wind' || lowerKey === 'wnd') {
      result.wind += numValue;
    }
    // Hydro (all variants)
    else if (lowerKey === 'hydro' || lowerKey === 'large_hydro' || lowerKey === 'small_hydro' || lowerKey === 'wat') {
      result.hydro += numValue;
    }
    // Geothermal
    else if (lowerKey === 'geothermal') {
      result.geothermal += numValue;
    }
    // Biomass (organic renewables)
    else if (lowerKey === 'biomass' || lowerKey === 'wood' || lowerKey === 'biogas' || 
             lowerKey === 'refuse' || lowerKey === 'landfill_gas' || 
             lowerKey === 'waste_disposal_services' || lowerKey === 'other_renewables') {
      result.biomass += numValue;
    }
    // Batteries/Storage
    else if (lowerKey === 'batteries' || lowerKey === 'storage' || lowerKey === 'power_storage') {
      result.batteries += numValue;
    }
    // Imports
    else if (lowerKey === 'imports') {
      result.imports += numValue;
    }
    // Coal
    else if (lowerKey === 'coal' || lowerKey === 'coal_and_lignite' || lowerKey === 'col') {
      result.coal += numValue;
    }
    // Natural Gas (all variants)
    else if (lowerKey === 'natural_gas' || lowerKey === 'gas' || lowerKey === 'dual_fuel' || 
             lowerKey === 'multiple_fuels' || lowerKey === 'ng') {
      result.gas += numValue;
    }
    // Oil
    else if (lowerKey === 'oil' || lowerKey === 'diesel_fuel_oil' || 
             lowerKey === 'other_fossil_fuels' || lowerKey === 'petroleum') {
      result.oil += numValue;
    }
    // Nuclear
    else if (lowerKey === 'nuclear' || lowerKey === 'nuc') {
      result.nuclear += numValue;
    }
    // Other catch-all
    else if (lowerKey === 'other' || lowerKey === 'waste_heat') {
      result.other += numValue;
    }
    // Skip metadata fields (timestamps, etc.)
    // Any truly unknown field gets silently dropped
  }

  // Convert MW to GW
  Object.keys(result).forEach(key => {
    result[key as EnergySource] = result[key as EnergySource] / 1000;
  });

  return result;
}

// ---------------------------------------------------------------------------
// API Functions
// ---------------------------------------------------------------------------

async function gridStatusFetch(
  dataset: string,
  startTime: string,
  endTime: string,
  apiKey: string
): Promise<GridStatusResponse> {
  const url = `${GRID_STATUS_BASE}/datasets/${dataset}/query?start_time=${startTime}&end_time=${endTime}`;
  
  const res = await fetch(url, {
    headers: {
      "x-api-key": apiKey,
    },
    next: { revalidate: 300 }, // Cache for 5 minutes
  });

  if (!res.ok) {
    throw new Error(`Grid Status API error ${res.status} for ${dataset}`);
  }

  return res.json();
}

/**
 * Aggregate 5-minute data points to hourly by taking the point closest to the top of each hour.
 * Converts UTC timestamps to local time for the specified region.
 */
function aggregateToHourly(
  dataPoints: GridStatusDataPoint[],
  date: string,
  location: string
): HistoricalRecord[] {
  const hourlyData: { [hour: number]: GridStatusDataPoint } = {};

  for (const point of dataPoints) {
    const utcTimestamp = point.interval_start_utc;
    const localDate = convertUTCToLocalDate(utcTimestamp, location);
    
    // Only process points that match the requested local date
    if (localDate !== date) {
      continue;
    }
    
    const localHour = convertUTCToLocalHour(utcTimestamp, location);
    const timestamp = new Date(utcTimestamp);
    const minute = timestamp.getUTCMinutes();

    // Take the data point closest to the top of the hour (00 or 05 minutes)
    if (!hourlyData[localHour] || minute <= 5) {
      hourlyData[localHour] = point;
    }
  }

  // Convert to our HistoricalRecord format
  const records: HistoricalRecord[] = [];
  for (let hour = 0; hour < 24; hour++) {
    const dataPoint = hourlyData[hour];
    const timestamp = `${date}T${String(hour).padStart(2, '0')}`;

    if (dataPoint) {
      const fuels = mapGridStatusFuels(dataPoint);
      records.push({
        date: timestamp,
        ...fuels,
      });
    } else {
      // No data for this hour, fill with zeros
      records.push({
        date: timestamp,
        solar: 0,
        wind: 0,
        hydro: 0,
        geothermal: 0,
        biomass: 0,
        batteries: 0,
        imports: 0,
        other: 0,
        coal: 0,
        gas: 0,
        oil: 0,
        nuclear: 0,
      });
    }
  }

  return records;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function fetchGridStatusHourly(
  location: string | null,
  date: string // YYYY-MM-DD in local time
): Promise<HistoricalRecord[]> {
  const apiKey = process.env.GRID_API_KEY;
  if (!apiKey) {
    throw new Error("GRID_API_KEY not configured");
  }

  if (!location) {
    throw new Error("Location is required for Grid Status API");
  }

  const upperLoc = location.toUpperCase();
  const dataset = ISO_DATASET_MAP[upperLoc];

  if (!dataset) {
    throw new Error(`No Grid Status dataset available for ${location}`);
  }

  // Query an efficient time range to capture the full local day
  // US timezones range from UTC-5 to UTC-8, so we need at most a 12-hour buffer
  // Query from 12 hours before local midnight to 12 hours after
  const localDate = new Date(date + 'T00:00:00');
  const startTime = new Date(localDate.getTime() - 12 * 60 * 60 * 1000).toISOString();
  const endTime = new Date(localDate.getTime() + 36 * 60 * 60 * 1000).toISOString();

  const response = await gridStatusFetch(dataset, startTime, endTime, apiKey);

  if (!response.data || response.data.length === 0) {
    throw new Error(`No data returned from Grid Status for ${location} on ${date}`);
  }

  return aggregateToHourly(response.data, date, location);
}

/**
 * Check if Grid Status has data for a given location
 */
export function isGridStatusSupported(location: string | null): boolean {
  if (!location) return false;
  return location.toUpperCase() in ISO_DATASET_MAP;
}

export { ISO_DATASET_MAP };
