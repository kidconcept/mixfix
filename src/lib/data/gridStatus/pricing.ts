/**
 * Grid Status Pricing (LMP) Data Fetcher
 * 
 * Fetches hourly Locational Marginal Pricing (LMP) data from Grid Status API.
 * Handles both native hourly datasets and sub-hourly datasets with aggregation.
 * 
 * Key features:
 * - Automatically selects hourly or sub-hourly datasets per ISO
 * - Aggregates 5-min/15-min data to hourly averages
 * - Uses request queue for timeout/retry/rate limiting
 * - Null vs zero distinction for missing data
 * - Timezone-aware (UTC to local conversion)
 */

import { LMPDataPoint } from "@/types/energy";
import { gridStatusQueue, RequestResult } from "../queue/requestQueue";
import { convertUTCToLocalHour, convertUTCToLocalDate } from "../../timezone";
import { 
  hasPricingData, 
  getGridStatusDataset, 
  getRepresentativeZone,
  getBAConfig 
} from "../../config/balancing-authorities";

const GRID_STATUS_BASE = "https://api.gridstatus.io/v1";

interface GridStatusLMPRow {
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
  data: GridStatusLMPRow[];
  meta?: {
    page?: number;
    hasNextPage?: boolean;
  };
}

/**
 * Check if an ISO is supported for LMP data
 */
export function isPricingSupported(iso: string): boolean {
  return hasPricingData(iso);
}

/**
 * Get default pricing zone for an ISO
 * This is a helper for UI to display zone options
 */
export function getDefaultPricingNode(iso: string): string {
  return getRepresentativeZone(iso) || "HUB";
}

/**
 * Fetch hourly LMP data for a specific ISO node and date
 * 
 * @param iso - ISO/RTO code (e.g., "NYISO", "CAISO")
 * @param node - Node/hub identifier (e.g., "CAPITL", ".H.INTERNAL_HUB")
 * @param date - Date in YYYY-MM-DD format (local time)
 * @returns Promise with request result containing hourly LMP data or error
 */
export async function fetchGridStatusPricing(
  iso: string,
  node: string,
  date: string
): Promise<RequestResult<LMPDataPoint[]>> {
  const apiKey = process.env.GRID_API_KEY;
  
  if (!apiKey) {
    return {
      success: false,
      error: {
        type: 'validation',
        message: 'GRID_API_KEY not configured',
        retryable: false,
      },
    };
  }

  const isoUpper = iso.toUpperCase();
  const dataset = getGridStatusDataset(isoUpper);
  
  if (!dataset) {
    return {
      success: false,
      error: {
        type: 'validation',
        message: `LMP data not supported for ISO: ${iso}`,
        retryable: false,
      },
    };
  }

  // Determine interval type based on dataset name
  const interval = dataset.includes('_5_min') || dataset.includes('_15_min') || dataset.includes('settlement_point')
    ? 'sub-hourly' 
    : 'hourly';

  // Build query URL
  const url = buildQueryURL(dataset, node, date);

  // Execute request through queue with timeout and retry
  const result = await gridStatusQueue.request(
    async () => {
      const response = await fetch(url, {
        headers: {
          "x-api-key": apiKey,
        },
      });
      
      const json: any = await response.json();
      
      // Check for quota/limit errors in response body (Grid Status returns these as 200 with detail field)
      if (json.detail) {
        const detail = json.detail.toLowerCase();
        if (detail.includes('limit reached') || detail.includes('quota') || detail.includes('usage')) {
          const error: any = new Error(`Grid Status API quota exceeded: ${json.detail}`);
          error.statusCode = 429;
          error.quotaExceeded = true;
          throw error;
        }
        // Other detail messages might be errors too
        if (!response.ok) {
          const error: any = new Error(`Grid Status API error: ${json.detail}`);
          error.statusCode = response.status;
          throw error;
        }
      }
      
      if (!response.ok) {
        const error: any = new Error(`Grid Status API error: ${response.status} ${response.statusText}`);
        error.statusCode = response.status;
        throw error;
      }
      
      const typedJson = json as GridStatusLMPResponse;
      
      // Check if we actually have data
      if (!typedJson.data || !Array.isArray(typedJson.data)) {
        const error: any = new Error('Grid Status API returned no data');
        error.statusCode = 500;
        throw error;
      }
      
      return typedJson.data;
    },
    {
      timeout: 45000,      // 45 second timeout (Grid Status can be slow)
      maxRetries: 3,       // Retry up to 3 times
      retryDelay: 1000,    // Start with 1 second delay
    }
  );

  // Handle request failure
  if (!result.success) {
    return result;
  }

  // Transform and aggregate data
  const records = interval === 'hourly'
    ? transformHourlyData(result.data, iso, date)
    : transformSubHourlyData(result.data, iso, date);

  return {
    success: true,
    data: records,
  };
}

/**
 * Build Grid Status API query URL
 */
function buildQueryURL(dataset: string, node: string, date: string): string {
  // Query time range: 12 hours before to 48 hours after local midnight
  // This ensures we capture all data including next day's hour 0 for any US timezone (UTC-5 to UTC-8)
  const localDate = new Date(date + 'T00:00:00');
  const startTime = new Date(localDate.getTime() - 12 * 60 * 60 * 1000).toISOString();
  const endTime = new Date(localDate.getTime() + 48 * 60 * 60 * 1000).toISOString();

  const params = new URLSearchParams({
    start_time: startTime,
    end_time: endTime,
    filter_column: 'location',
    filter_value: node,
    limit: '200', // Enough for 24 hours × 4 intervals/hour = 96, with buffer
  });

  return `${GRID_STATUS_BASE}/datasets/${dataset}/query?${params}`;
}

/**
 * Transform hourly LMP data (already at correct granularity)
 */
function transformHourlyData(
  rows: GridStatusLMPRow[],
  iso: string,
  date: string
): LMPDataPoint[] {
  const hourlyMap = new Map<number, GridStatusLMPRow>();
  
  // Calculate next day for hour 24 (simple string arithmetic to avoid timezone issues)
  const [year, month, day] = date.split('-').map(Number);
  const nextDate = new Date(year, month - 1, day + 1);
  const nextDayStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`;

  for (const row of rows) {
    const localDate = convertUTCToLocalDate(row.interval_start_utc, iso);
    const localHour = convertUTCToLocalHour(row.interval_start_utc, iso);
    
    // Include data for requested date OR hour 0 of next day (mapped to hour 24)
    if (localDate === date) {
      if (!hourlyMap.has(localHour)) {
        hourlyMap.set(localHour, row);
      }
    } else if (localDate === nextDayStr && localHour === 0) {
      // Map next day's hour 0 to hour 24
      if (!hourlyMap.has(24)) {
        hourlyMap.set(24, row);
      }
    }
  }

  // Convert to array and sort
  const records: LMPDataPoint[] = [];
  
  // Include hours 0-24 (where 24 is next day's hour 0)
  for (let hour = 0; hour <= 24; hour++) {
    const row = hourlyMap.get(hour);
    
    if (row) {
      const timeStr = `${date}T${String(hour).padStart(2, '0')}:00:00`;
      
      records.push({
        time: timeStr,
        lmp: Number(row.lmp.toFixed(2)),
        energy: Number(row.energy.toFixed(2)),
        congestion: Number(row.congestion.toFixed(2)),
        loss: Number(row.loss.toFixed(2)),
      });
    }
  }

  return records;
}

/**
 * Transform sub-hourly LMP data (5-min or 15-min) by aggregating to hourly averages
 */
function transformSubHourlyData(
  rows: GridStatusLMPRow[],
  iso: string,
  date: string
): LMPDataPoint[] {
  const hourlyMap = new Map<number, GridStatusLMPRow[]>();
  
  // Calculate next day for hour 24 (simple string arithmetic to avoid timezone issues)
  const [year, month, day] = date.split('-').map(Number);
  const nextDate = new Date(year, month - 1, day + 1);
  const nextDayStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`;

  // Group by local hour
  for (const row of rows) {
    const localDate = convertUTCToLocalDate(row.interval_start_utc, iso);
    const localHour = convertUTCToLocalHour(row.interval_start_utc, iso);
    
    // Include data for requested date OR hour 0 of next day (mapped to hour 24)
    if (localDate === date) {
      if (!hourlyMap.has(localHour)) {
        hourlyMap.set(localHour, []);
      }
      hourlyMap.get(localHour)!.push(row);
    } else if (localDate === nextDayStr && localHour === 0) {
      // Map next day's hour 0 to hour 24
      if (!hourlyMap.has(24)) {
        hourlyMap.set(24, []);
      }
      hourlyMap.get(24)!.push(row);
    }
  }

  // Average each hour's data points
  const records: LMPDataPoint[] = [];
  
  // Include hours 0-24 (where 24 is next day's hour 0)
  for (let hour = 0; hour <= 24; hour++) {
    const points = hourlyMap.get(hour);
    
    if (points && points.length > 0) {
      const count = points.length;
      
      // Calculate averages
      const avgLMP = points.reduce((sum, p) => sum + p.lmp, 0) / count;
      const avgEnergy = points.reduce((sum, p) => sum + p.energy, 0) / count;
      const avgCongestion = points.reduce((sum, p) => sum + p.congestion, 0) / count;
      const avgLoss = points.reduce((sum, p) => sum + p.loss, 0) / count;

      const timeStr = `${date}T${String(hour).padStart(2, '0')}:00:00`;
      
      records.push({
        time: timeStr,
        lmp: Number(avgLMP.toFixed(2)),
        energy: Number(avgEnergy.toFixed(2)),
        congestion: Number(avgCongestion.toFixed(2)),
        loss: Number(avgLoss.toFixed(2)),
      });
    }
  }

  return records;
}
