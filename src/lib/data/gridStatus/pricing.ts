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

const GRID_STATUS_BASE = "https://api.gridstatus.io/v1";

// Mapping ISO names to Grid Status LMP dataset IDs
// Preference for hourly datasets to minimize data volume
const ISO_LMP_DATASET_MAP: Record<string, { dataset: string; interval: 'hourly' | 'sub-hourly' }> = {
  NYISO: { dataset: "nyiso_lmp_real_time_hourly", interval: 'hourly' },
  NYIS: { dataset: "nyiso_lmp_real_time_hourly", interval: 'hourly' },
  ISONE: { dataset: "isone_lmp_real_time_hourly_final", interval: 'hourly' },
  ISNE: { dataset: "isone_lmp_real_time_hourly_final", interval: 'hourly' },
  PJM: { dataset: "pjm_lmp_real_time_hourly", interval: 'hourly' },
  MISO: { dataset: "miso_lmp_real_time_hourly_final", interval: 'hourly' },
  
  // Sub-hourly datasets (require aggregation)
  CAISO: { dataset: "caiso_lmp_real_time_15_min", interval: 'sub-hourly' },
  CISO: { dataset: "caiso_lmp_real_time_15_min", interval: 'sub-hourly' },
  ERCOT: { dataset: "ercot_lmp_by_settlement_point", interval: 'sub-hourly' },
  ERCO: { dataset: "ercot_lmp_by_settlement_point", interval: 'sub-hourly' },
  SPP: { dataset: "spp_lmp_real_time_5_min", interval: 'sub-hourly' },
  SWPP: { dataset: "spp_lmp_real_time_5_min", interval: 'sub-hourly' },
};

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
  const isoUpper = iso.toUpperCase();
  return !!ISO_LMP_DATASET_MAP[isoUpper];
}

/**
 * Get available pricing nodes for an ISO
 * This is a helper for UI to display node options
 */
export function getDefaultPricingNode(iso: string): string {
  const defaults: Record<string, string> = {
    NYISO: "CAPITL",
    CAISO: "SLAP_PGAE-APND",
    PJM: "AEP",
    MISO: "MISO.ILLINOIS",
    ERCOT: "HB_HOUSTON",
    ISONE: ".H.INTERNAL_HUB",
    SPP: "SPP.SPPSYSTEM",
  };
  
  return defaults[iso.toUpperCase()] || "HUB";
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
  const config = ISO_LMP_DATASET_MAP[isoUpper];
  
  if (!config) {
    return {
      success: false,
      error: {
        type: 'validation',
        message: `LMP data not supported for ISO: ${iso}`,
        retryable: false,
      },
    };
  }

  // Build query URL
  const url = buildQueryURL(config.dataset, node, date);

  // Execute request through queue with timeout and retry
  const result = await gridStatusQueue.request(
    async () => {
      const response = await fetch(url, {
        headers: {
          "x-api-key": apiKey,
        },
      });
      
      if (!response.ok) {
        const error: any = new Error(`Grid Status API error: ${response.status} ${response.statusText}`);
        error.statusCode = response.status;
        throw error;
      }
      
      const json: GridStatusLMPResponse = await response.json();
      return json.data ?? [];
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
  const records = config.interval === 'hourly'
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
  
  // Calculate next day for hour 24
  const nextDay = new Date(date);
  nextDay.setDate(nextDay.getDate() + 1);
  const nextDayStr = nextDay.toISOString().split('T')[0];

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
  
  // Calculate next day for hour 24
  const nextDay = new Date(date);
  nextDay.setDate(nextDay.getDate() + 1);
  const nextDayStr = nextDay.toISOString().split('T')[0];

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

/**
 * Get mock pricing data for development/testing
 */
export function getMockPricingData(date: string): LMPDataPoint[] {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  return hours.map(hour => {
    const timeStr = `${date}T${String(hour).padStart(2, '0')}:00:00`;
    
    // Simulate typical daily pricing pattern
    // Higher during peak hours (8am-8pm), lower at night
    const isPeak = hour >= 8 && hour <= 20;
    const baseLMP = isPeak ? 45 : 25;
    const variation = Math.random() * 20 - 10;
    
    const lmp = baseLMP + variation;
    const energy = lmp * 0.85; // Energy is typically ~85% of LMP
    const congestion = Math.random() * 5 - 2.5; // Small congestion component
    const loss = lmp - energy - congestion; // Loss is the remainder
    
    return {
      time: timeStr,
      lmp: Number(lmp.toFixed(2)),
      energy: Number(energy.toFixed(2)),
      congestion: Number(congestion.toFixed(2)),
      loss: Number(loss.toFixed(2)),
    };
  });
}
