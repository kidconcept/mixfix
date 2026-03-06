import { EnergySource, HistoricalRecord } from "@/types/energy";

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
 */
function mapGridStatusFuels(dataPoint: GridStatusDataPoint): Record<EnergySource, number> {
  const result: Record<EnergySource, number> = {
    solar: 0,
    wind: 0,
    hydro: 0,
    nuclear: 0,
    gas: 0,
    coal: 0,
    oil: 0,
    other: 0,
  };

  // NYISO-specific mapping
  if ("dual_fuel" in dataPoint) {
    // Dual fuel units typically run on natural gas
    result.gas = (dataPoint.dual_fuel as number || 0) + (dataPoint.natural_gas as number || 0);
    result.hydro = dataPoint.hydro as number || 0;
    result.nuclear = dataPoint.nuclear as number || 0;
    result.wind = dataPoint.wind as number || 0;
    result.oil = dataPoint.other_fossil_fuels as number || 0;
    result.other = dataPoint.other_renewables as number || 0;
    // Solar is included in other_renewables for NYISO
  }
  // CAISO, ERCOT, and other ISOs may have different field names
  else if ("natural_gas" in dataPoint) {
    result.gas = dataPoint.natural_gas as number || 0;
    result.hydro = dataPoint.hydro as number || 0;
    result.nuclear = dataPoint.nuclear as number || 0;
    result.wind = dataPoint.wind as number || 0;
    result.solar = dataPoint.solar as number || 0;
    result.coal = dataPoint.coal as number || 0;
    result.oil = dataPoint.oil as number || 0;
    
    // Catch-all for other fields
    if ("other" in dataPoint) {
      result.other = dataPoint.other as number || 0;
    }
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
 */
function aggregateToHourly(
  dataPoints: GridStatusDataPoint[],
  date: string
): HistoricalRecord[] {
  const hourlyData: { [hour: number]: GridStatusDataPoint } = {};

  for (const point of dataPoints) {
    const timestamp = new Date(point.interval_start_utc);
    const hour = timestamp.getUTCHours();
    const minute = timestamp.getUTCMinutes();

    // Take the data point closest to the top of the hour (00 or 05 minutes)
    if (!hourlyData[hour] || minute <= 5) {
      hourlyData[hour] = point;
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
        nuclear: 0,
        gas: 0,
        coal: 0,
        oil: 0,
        other: 0,
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
  date: string // YYYY-MM-DD
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

  // Grid Status uses UTC times, so we need to query a full day in UTC
  const startTime = `${date}T00:00:00Z`;
  const endTime = `${date}T23:59:59Z`;

  const response = await gridStatusFetch(dataset, startTime, endTime, apiKey);

  if (!response.data || response.data.length === 0) {
    throw new Error(`No data returned from Grid Status for ${location} on ${date}`);
  }

  return aggregateToHourly(response.data, date);
}

/**
 * Check if Grid Status has data for a given location
 */
export function isGridStatusSupported(location: string | null): boolean {
  if (!location) return false;
  return location.toUpperCase() in ISO_DATASET_MAP;
}

export { ISO_DATASET_MAP };
