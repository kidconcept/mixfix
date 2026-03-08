/**
 * EIA Fuel Mix Data Fetcher
 * 
 * Fetches hourly electricity generation fuel mix data from EIA API v2
 * using frequency=hourly parameter to minimize data volume.
 * 
 * Key features:
 * - Request exactly 24 hourly data points per day
 * - Null vs zero distinction (null = missing data, 0 = actual zero)
 * - Uses request queue for timeout/retry/rate limiting
 * - No zero-filling (preserves data gaps for validation)
 */

import { HistoricalRecord, EnergySource } from "@/types/energy";
import { eiaQueue, RequestResult } from "../queue/requestQueue";
import { getEIACode } from "../../config/balancing-authorities";

const EIA_BASE = "https://api.eia.gov/v2";
const EIA_RTO_ENDPOINT = `${EIA_BASE}/electricity/rto/fuel-type-data/data/`;

// EIA fuel type ID to our standardized energy source
const FUELTYPEID_MAP: Record<string, EnergySource> = {
  COL: "coal",
  NG: "gas",
  NUC: "nuclear",
  WAT: "hydro",
  SUN: "solar",
  WND: "wind",
  OIL: "oil",
  OTH: "other",
};

interface EIARow {
  period: string;        // ISO timestamp (2024-01-01T00:00:00)
  respondent: string;    // Balancing authority code
  fueltype: string;      // Fuel type code (COL, NG, etc.)
  "type-name": string;   // Human-readable fuel type
  value: number;         // Generation in MWh
}

interface EIAResponse {
  response?: {
    data?: EIARow[];
  };
}

/**
 * Fetch hourly fuel mix data from EIA API for a specific location and date
 * 
 * @param location - ISO/RTO code (e.g., "NYISO", "CAISO") or 2-letter state code
 * @param date - Date in YYYY-MM-DD format
 * @returns Promise with request result containing hourly records or error
 */
export async function fetchEIAFuelMix(
  location: string,
  date: string
): Promise<RequestResult<HistoricalRecord[]>> {
  const apiKey = process.env.EIA_API_KEY;
  
  if (!apiKey) {
    return {
      success: false,
      error: {
        type: 'validation',
        message: 'EIA_API_KEY not configured',
        retryable: false,
      },
    };
  }

  // Build query parameters
  const params = buildParams(apiKey, location, date);
  const url = `${EIA_RTO_ENDPOINT}?${params}`;

  // Execute request through queue with timeout and retry
  const startTime = Date.now();
  console.log(`[EIA] Starting fetch for ${location} on ${date}...`);
  
  const result = await eiaQueue.request(
    async () => {
      const fetchStartTime = Date.now();
      const response = await fetch(url);
      
      if (!response.ok) {
        const error: any = new Error(`EIA API error: ${response.status} ${response.statusText}`);
        error.statusCode = response.status;
        throw error;
      }
      
      const json: EIAResponse = await response.json();
      const fetchEndTime = Date.now();
      console.log(`[EIA] Fetch completed in ${fetchEndTime - fetchStartTime}ms`);
      return json.response?.data ?? [];
    },
    {
      timeout: 30000,      // 30 second timeout
      maxRetries: 3,       // Retry up to 3 times
      retryDelay: 1000,    // Start with 1 second delay
    }
  );

  // Handle request failure
  if (!result.success) {
    return result;
  }

  // Transform EIA rows to hourly records
  const records = transformEIAData(result.data, date);
  
  const totalTime = Date.now() - startTime;
  console.log(`[EIA] Total request time (including queue/retry): ${totalTime}ms, returned ${records.length} hourly records`);

  return {
    success: true,
    data: records,
  };
}

/**
 * Build URL parameters for EIA API request
 */
function buildParams(apiKey: string, location: string, date: string): URLSearchParams {
  const params = new URLSearchParams();
  
  // API key and data selection
  params.set("api_key", apiKey);
  params.append("data[0]", "value");
  
  // CRITICAL: Request hourly frequency to get exactly 25 data points
  // Without this, we'd get 288 5-minute intervals (12x more data)
  params.set("frequency", "hourly");
  
  // Time range: requested day plus hour 0 of next day (00:00 to next day 00:00)
  // This gives us 25 hours to show the daily cycle completing
  const nextDay = new Date(date);
  nextDay.setDate(nextDay.getDate() + 1);
  const nextDayStr = nextDay.toISOString().split('T')[0];
  
  params.set("start", `${date}T00`);
  params.set("end", `${nextDayStr}T00`);
  
  // Sorting
  params.set("sort[0][column]", "period");
  params.set("sort[0][direction]", "asc");
  
  // Location facet
  const upperLoc = location.toUpperCase();
  const eiaCode = getEIACode(upperLoc);
  
  if (eiaCode) {
    // Balancing authority (from config)
    params.append("facets[respondent][]", eiaCode);
  } else if (upperLoc.length === 2) {
    // State code
    params.append("facets[stateid][]", upperLoc);
  }
  
  // NOTE: Removed length parameter to avoid artificial truncation
  // EIA will return all matching records (typically 24 hours × ~8 fuel types = ~192 rows)
  
  return params;
}

/**
 * Transform EIA API rows into our hourly record format
 * 
 * Key behaviors:
 * - Groups by hour and sums values for each fuel type
 * - Converts MWh to GW (divide by 1000)
 * - Uses null for missing fuel types (not zero)
 * - Only includes hours within the requested date
 */
function transformEIAData(rows: EIARow[], date: string): HistoricalRecord[] {
  const hourlyMap = new Map<string, Map<EnergySource, number>>();
  
  // Calculate next day for hour 24 mapping
  const nextDay = new Date(date);
  nextDay.setDate(nextDay.getDate() + 1);
  const nextDayStr = nextDay.toISOString().split('T')[0];

  for (const row of rows) {
    let hour = row.period;
    
    // Handle hour 24 notation (ISO 8601): convert to next day's hour 0
    if (hour && hour.includes('T24')) {
      hour = hour.replace('T24', 'T00');
      // Update date part if needed
      const datePart = hour.split('T')[0];
      if (datePart === date) {
        hour = `${nextDayStr}T00`;
      }
    }
    
    // Accept hours from requested date OR hour 0 of next day
    const isRequestedDate = hour && hour.startsWith(date);
    const isNextDayHour0 = hour && hour.startsWith(`${nextDayStr}T00`);
    
    if (!hour || (!isRequestedDate && !isNextDayHour0)) {
      continue;
    }

    // Get or create hour map
    if (!hourlyMap.has(hour)) {
      hourlyMap.set(hour, new Map());
    }
    const hourData = hourlyMap.get(hour)!;

    // Map fuel type and accumulate value
    const source: EnergySource = FUELTYPEID_MAP[row.fueltype] ?? "other";
    const currentValue = hourData.get(source) ?? 0;
    const newValue = currentValue + (row.value / 1000); // MWh → GW
    
    hourData.set(source, newValue);
  }

  // Convert map to array of records
  const records: HistoricalRecord[] = [];
  
  // Sort hours chronologically
  const sortedHours = Array.from(hourlyMap.keys()).sort();
  
  for (const hour of sortedHours) {
    const sources = hourlyMap.get(hour)!;
    
    // Map next day's hour 0 to hour 24 for display
    let displayHour = hour;
    if (hour.startsWith(`${nextDayStr}T00`)) {
      displayHour = `${date}T24`;
    }
    
    // Build record with null for missing sources (NOT zero)
    // This allows validation layer to detect gaps vs actual zero generation
    const record: HistoricalRecord = {
      date: displayHour,
    };

    // Add all fuel types that have data
    for (const [source, value] of sources.entries()) {
      record[source] = value;
    }

    records.push(record);
  }

  return records;
}

/**
 * Get mock data for development/testing when EIA API is unavailable
 */
export function getMockEIAFuelMix(date: string): HistoricalRecord[] {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  return hours.map(hour => {
    const timestamp = `${date}T${String(hour).padStart(2, '0')}:00:00`;
    const solarFactor = Math.max(0, Math.sin((hour - 6) * Math.PI / 12));
    
    return {
      date: timestamp,
      solar: solarFactor * 150,
      wind: 180 + Math.random() * 40 - 20,
      hydro: 110,
      nuclear: 85,
      gas: 200 - solarFactor * 50,
      coal: 120,
      oil: 17,
      other: 9,
    };
  });
}
