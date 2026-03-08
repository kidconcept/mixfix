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
import { convertUTCToLocalDate, convertUTCToLocalHour } from "../../timezone";

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

  // Log BA code mapping for verification
  const upperLoc = location.toUpperCase();
  const eiaCode = getEIACode(upperLoc);
  const facetType = eiaCode ? 'respondent' : (upperLoc.length === 2 ? 'stateid' : 'unknown');
  const facetValue = eiaCode || (upperLoc.length === 2 ? upperLoc : 'N/A');
  
  console.log(`[EIA] Starting fetch for ${location} on ${date}`);
  console.log(`[EIA] BA Mapping: ${location} → ${facetType}=${facetValue}`);
  console.log(`[EIA] Request URL: ${url}`);

  // Execute request through queue with timeout and retry
  const startTime = Date.now();
  
  const result = await eiaQueue.request(
    async () => {
      const fetchStartTime = Date.now();
      const response = await fetch(url);
      
      if (!response.ok) {
        const json: any = await response.json().catch(() => ({}));
        
        // Check for rate limit error (HTTP 429 or error message)
        if (response.status === 429 || json.error?.message?.toLowerCase().includes('rate limit')) {
          const error: any = new Error(`EIA API rate limit exceeded: ${json.error?.message || 'Too many requests'}`);
          error.statusCode = 429;
          error.rateLimitExceeded = true;
          throw error;
        }
        
        const error: any = new Error(`EIA API error: ${response.status} ${response.statusText}`);
        error.statusCode = response.status;
        throw error;
      }
      
      const json: EIAResponse = await response.json();
      const fetchEndTime = Date.now();
      const rawRows = json.response?.data ?? [];
      console.log(`[EIA] Fetch completed in ${fetchEndTime - fetchStartTime}ms, received ${rawRows.length} raw rows`);
      return rawRows;
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
  const rawRowCount = result.data.length;
  const records = transformEIAData(result.data, date, location);
  
  const totalTime = Date.now() - startTime;
  console.log(`[EIA] Total request time (including queue/retry): ${totalTime}ms`);
  console.log(`[EIA] Data transformation: ${rawRowCount} raw rows → ${records.length} hourly records`);
  
  if (rawRowCount === 0) {
    console.warn(`[EIA] WARNING: No data returned from EIA API for ${location} on ${date}`);
  }

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
  
  // Time range in UTC: requested day through the following UTC day.
  // We need this wider window because we later convert to local time and keep
  // local hours 0-23 plus next day's local hour 0 (bucket 24).
  const [year, month, day] = date.split('-').map(Number);
  const nextDate = new Date(year, month - 1, day + 1);
  const nextDayStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`;
  const dayAfterNextDate = new Date(year, month - 1, day + 2);
  const dayAfterNextStr = `${dayAfterNextDate.getFullYear()}-${String(dayAfterNextDate.getMonth() + 1).padStart(2, '0')}-${String(dayAfterNextDate.getDate()).padStart(2, '0')}`;
  
  params.set("start", `${date}T00`);
  params.set("end", `${dayAfterNextStr}T00`);
  
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
function transformEIAData(rows: EIARow[], date: string, location: string): HistoricalRecord[] {
  const hourlyMap = new Map<number, Map<EnergySource, number>>();
  
  // Calculate next day for hour 24 mapping (simple string arithmetic to avoid timezone issues)
  const [year, month, day] = date.split('-').map(Number);
  const nextDate = new Date(year, month - 1, day + 1);
  const nextDayStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`;

  for (const row of rows) {
    if (!row.period) {
      continue;
    }

    // Convert EIA UTC period into local date/hour for the selected BA.
    const localDate = convertUTCToLocalDate(row.period, location);
    const localHour = convertUTCToLocalHour(row.period, location);

    // Keep 25-hour range: requested day hours 0-23 plus next-day hour 0 as bucket 24.
    let bucketHour: number | null = null;
    if (localDate === date) {
      bucketHour = localHour;
    } else if (localDate === nextDayStr && localHour === 0) {
      bucketHour = 24;
    }

    if (bucketHour === null) {
      continue;
    }

    // Get or create hour map
    if (!hourlyMap.has(bucketHour)) {
      hourlyMap.set(bucketHour, new Map());
    }
    const hourData = hourlyMap.get(bucketHour)!;

    // Map fuel type and accumulate value
    const source: EnergySource = FUELTYPEID_MAP[row.fueltype] ?? "other";
    const currentValue = hourData.get(source) ?? 0;
    const newValue = currentValue + (row.value / 1000); // MWh → GW
    
    hourData.set(source, newValue);
  }

  // Convert map to array of records
  const records: HistoricalRecord[] = [];
  
  // Sort hours chronologically
  const sortedHours = Array.from(hourlyMap.keys()).sort((a, b) => a - b);
  
  for (const hour of sortedHours) {
    const sources = hourlyMap.get(hour)!;
    
    // Build record with null for missing sources (NOT zero)
    // This allows validation layer to detect gaps vs actual zero generation
    const record: HistoricalRecord = {
      date: `${date}T${String(hour).padStart(2, '0')}`,
    };

    // Add all fuel types that have data
    for (const [source, value] of sources.entries()) {
      record[source] = value;
    }

    records.push(record);
  }

  return records;
}
