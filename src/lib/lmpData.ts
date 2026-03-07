import { LMPDataPoint } from "@/types/energy";
import { convertUTCToLocalHour, convertUTCToLocalDate } from "./timezone";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GRID_STATUS_BASE = "https://api.gridstatus.io/v1";

// Simple in-memory cache for LMP data to reduce API calls
const lmpCache = new Map<string, { data: LMPDataPoint[]; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Request queue to throttle API calls
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 500; // 500ms between requests

// Mapping ISO names to Grid Status LMP dataset IDs
const ISO_LMP_DATASET_MAP: Record<string, string> = {
  NYISO: "nyiso_lmp_real_time_hourly",
  NYIS: "nyiso_lmp_real_time_hourly",
  CAISO: "caiso_lmp_real_time_15_min", // No hourly available, will aggregate
  CISO: "caiso_lmp_real_time_15_min",
  ERCOT: "ercot_lmp_by_settlement_point", // 15-min intervals
  ERCO: "ercot_lmp_by_settlement_point",
  ISONE: "isone_lmp_real_time_hourly_final",
  ISNE: "isone_lmp_real_time_hourly_final",
  MISO: "miso_lmp_real_time_hourly_final",
  PJM: "pjm_lmp_real_time_hourly",
  SPP: "spp_lmp_real_time_5_min", // No hourly available, will aggregate
  SWPP: "spp_lmp_real_time_5_min",
};

// ---------------------------------------------------------------------------
// Grid Status LMP API Types
// ---------------------------------------------------------------------------

interface GridStatusLMPDataPoint {
  interval_start_utc: string;
  interval_end_utc: string;
  market: string;
  location: string;
  location_type: string;
  lmp: number;
  energy: number;
  congestion: number;
  loss: number;
}

interface GridStatusLMPResponse {
  status_code: number;
  data: GridStatusLMPDataPoint[];
  meta: {
    page: number;
    hasNextPage: boolean;
  };
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Aggregate sub-hourly LMP data (15-min or 5-min) to hourly by averaging
 * Converts UTC timestamps to local time for the specified region.
 */
function aggregateToHourly(data: LMPDataPoint[], location: string, date: string): LMPDataPoint[] {
  const hourlyMap = new Map<number, LMPDataPoint[]>();

  // Group by local hour
  for (const point of data) {
    const localDate = convertUTCToLocalDate(point.time, location);
    
    // Only process points that match the requested local date
    if (localDate !== date) {
      continue;
    }
    
    const localHour = convertUTCToLocalHour(point.time, location);
    
    if (!hourlyMap.has(localHour)) {
      hourlyMap.set(localHour, []);
    }
    hourlyMap.get(localHour)!.push(point);
  }

  // Average each hour's data
  const hourlyData: LMPDataPoint[] = [];
  for (let hour = 0; hour < 24; hour++) {
    const points = hourlyMap.get(hour);
    
    if (points && points.length > 0) {
      const count = points.length;
      const avgLMP = points.reduce((sum, p) => sum + p.lmp, 0) / count;
      const avgEnergy = points.reduce((sum, p) => sum + p.energy, 0) / count;
      const avgCongestion = points.reduce((sum, p) => sum + p.congestion, 0) / count;
      const avgLoss = points.reduce((sum, p) => sum + p.loss, 0) / count;

      // Create timestamp in local time format
      const timeStr = `${date}T${String(hour).padStart(2, '0')}:00:00`;
      
      hourlyData.push({
        time: timeStr,
        lmp: Number(avgLMP.toFixed(2)),
        energy: Number(avgEnergy.toFixed(2)),
        congestion: Number(avgCongestion.toFixed(2)),
        loss: Number(avgLoss.toFixed(2)),
      });
    }
  }

  return hourlyData.sort((a, b) => a.time.localeCompare(b.time));
}

// ---------------------------------------------------------------------------
// Public API Functions
// ---------------------------------------------------------------------------

/**
 * Check if an ISO is supported for LMP data via Grid Status
 */
export function isLMPSupported(iso: string): boolean {
  const isoUpper = iso.toUpperCase();
  return !!ISO_LMP_DATASET_MAP[isoUpper];
}

/**
 * Fetch hourly LMP data for a specific node from Grid Status API
 * @param iso - ISO/RTO identifier (e.g., "NYISO", "CAISO")
 * @param node - Node/location name (e.g., "CAPITL")
 * @param date - Date string in YYYY-MM-DD format
 * @returns Array of 24 hourly LMP data points
 */
export async function fetchLMPHourly(
  iso: string,
  node: string,
  date: string
): Promise<LMPDataPoint[]> {
  const isoUpper = iso.toUpperCase();
  const datasetId = ISO_LMP_DATASET_MAP[isoUpper];

  if (!datasetId) {
    throw new Error(`LMP data not supported for ISO: ${iso}`);
  }

  // Check cache first
  const cacheKey = `${isoUpper}-${node}-${date}`;
  const cached = lmpCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log('LMP data served from cache:', { iso, node, date });
    return cached.data;
  }

  const apiKey = process.env.GRID_API_KEY;
  if (!apiKey) {
    throw new Error("GRID_API_KEY not configured");
  }

  // Throttle requests to avoid rate limits
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    const delay = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
    console.log(`Throttling request, waiting ${delay}ms`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  lastRequestTime = Date.now();

  // Query an efficient time range to capture the full local day
  // US timezones range from UTC-5 to UTC-8, so we need at most a 12-hour buffer
  // Query from 12 hours before local midnight to 12 hours after
  const localDate = new Date(date + 'T00:00:00');
  const startTime = new Date(localDate.getTime() - 12 * 60 * 60 * 1000).toISOString();
  const endTime = new Date(localDate.getTime() + 36 * 60 * 60 * 1000).toISOString();

  // Use server-side filtering by location for efficiency
  const locationFilter = `&filter_column=location&filter_value=${encodeURIComponent(node)}`;
  
  // For sub-hourly datasets (15-min, 5-min), use API resampling to hourly
  const needsResampling = ['CAISO', 'CISO', 'ERCOT', 'ERCO', 'SPP', 'SWPP'].includes(isoUpper);
  const resampleParams = needsResampling
    ? '&resample_frequency=1 hour&resample_by=location&resample_function=mean'
    : '';

  const url = `${GRID_STATUS_BASE}/datasets/${datasetId}/query?start_time=${startTime}&end_time=${endTime}${locationFilter}${resampleParams}&limit=100`;

  console.log('Fetching LMP data:', { iso, node, date, needsResampling });

  try {
    const response = await fetch(url, {
      headers: {
        "x-api-key": apiKey,
      },
      signal: AbortSignal.timeout(60000), // 60 second timeout - Grid Status can be slow
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Grid Status API error:', response.status, errorText);
      
      // Handle rate limiting specifically
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const retrySeconds = retryAfter ? parseInt(retryAfter) : 60;
        console.error('Rate limit exceeded, retry after:', retrySeconds, 'seconds');
        throw new Error(
          `Rate limit exceeded. The Grid Status API is temporarily restricting requests. Please wait ${retrySeconds} seconds before trying again.`
        );
      }
      
      throw new Error(
        `Grid Status API error: ${response.status} ${response.statusText}`
      );
    }

    const json: GridStatusLMPResponse = await response.json();

    console.log('LMP data received:', { 
    totalRecords: json.data.length,
    sampleLocation: json.data[0]?.location,
    sampleLocationType: json.data[0]?.location_type,
  });

  // For NYISO, filter to Zone-level data only (not nodal) since location name alone
  // may match both zones and nodes
  let filteredData = json.data;
  if (isoUpper === 'NYISO' || isoUpper === 'NYIS') {
    filteredData = json.data.filter(d => d.location_type === 'Zone');
    console.log('Filtered to NYISO zones:', { total: json.data.length, zones: filteredData.length });
  }

  if (filteredData.length === 0) {
    console.warn('No data found for node:', node);
    return [];
  }

  // Map to our LMP format
  const lmpDataUTC: LMPDataPoint[] = filteredData.map((d) => ({
    time: d.interval_start_utc,
    lmp: d.lmp,
    energy: d.energy,
    congestion: d.congestion,
    loss: d.loss,
  }));

  // Convert to local time and aggregate to hourly if needed
  const lmpData = needsResampling 
    ? aggregateToHourly(lmpDataUTC, iso, date)
    : aggregateToHourly(lmpDataUTC, iso, date); // Always aggregate to convert to local time

  // Sort by time
  lmpData.sort((a, b) => a.time.localeCompare(b.time));

  // Cache the successful result
  lmpCache.set(cacheKey, {
    data: lmpData,
    timestamp: Date.now(),
  });
  console.log('LMP data cached:', { cacheKey, dataPoints: lmpData.length });

  return lmpData;
  } catch (error) {
    // Provide more specific error messages for common issues
    if (error instanceof Error) {
      if (error.name === 'AbortError' || error.name === 'TimeoutError') {
        console.error('LMP data fetch timeout:', { iso, node, date });
        throw new Error(`Timeout fetching pricing data from Grid Status API. The service may be experiencing delays. Please try again or select a more recent date.`);
      }
      if (error.message.includes('fetch failed') || error.message.includes('network')) {
        console.error('LMP data network error:', { iso, node, date, error: error.message });
        throw new Error(`Network error connecting to Grid Status API. Please check your connection and try again.`);
      }
      if (error.message.includes('Rate limit')) {
        // Already formatted, just re-throw
        throw error;
      }
    }
    // Re-throw the original error if it's not one we specifically handle
    throw error;
  }
}

/**
 * Clear the LMP data cache (useful for testing or forcing refresh)
 */
export function clearLMPCache(): void {
  lmpCache.clear();
  console.log('LMP cache cleared');
}

/**
 * Get list of available nodes for an ISO
 * This queries a sample time period to discover nodes
 */
export async function getAvailableNodes(
  iso: string,
  sampleDate: string = "2024-03-01"
): Promise<string[]> {
  const isoUpper = iso.toUpperCase();
  const datasetId = ISO_LMP_DATASET_MAP[isoUpper];

  if (!datasetId) {
    return [];
  }

  const apiKey = process.env.GRID_API_KEY;
  if (!apiKey) {
    return [];
  }

  // Query just one hour to get the list of nodes
  const startTime = `${sampleDate}T00:00:00Z`;
  const endTime = `${sampleDate}T01:00:00Z`;

  const url = `${GRID_STATUS_BASE}/datasets/${datasetId}/query?start_time=${startTime}&end_time=${endTime}&limit=10000`;

  try {
    const response = await fetch(url, {
      headers: {
        "x-api-key": apiKey,
      },
    });

    if (!response.ok) {
      return [];
    }

    const json: GridStatusLMPResponse = await response.json();

    // Extract unique node names
    const nodes = Array.from(new Set(json.data.map((d) => d.location))).sort();

    return nodes;
  } catch (error) {
    console.error("Error fetching available nodes:", error);
    return [];
  }
}
