import { LMPDataPoint } from "@/types/energy";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GRID_STATUS_BASE = "https://api.gridstatus.io/v1";

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
 */
function aggregateToHourly(data: LMPDataPoint[]): LMPDataPoint[] {
  const hourlyMap = new Map<string, LMPDataPoint[]>();

  // Group by hour
  for (const point of data) {
    const hourKey = point.time.substring(0, 13); // "2024-03-01T05"
    if (!hourlyMap.has(hourKey)) {
      hourlyMap.set(hourKey, []);
    }
    hourlyMap.get(hourKey)!.push(point);
  }

  // Average each hour's data
  const hourlyData: LMPDataPoint[] = [];
  for (const [hourKey, points] of hourlyMap) {
    const count = points.length;
    const avgLMP = points.reduce((sum, p) => sum + p.lmp, 0) / count;
    const avgEnergy = points.reduce((sum, p) => sum + p.energy, 0) / count;
    const avgCongestion = points.reduce((sum, p) => sum + p.congestion, 0) / count;
    const avgLoss = points.reduce((sum, p) => sum + p.loss, 0) / count;

    hourlyData.push({
      time: `${hourKey}:00:00+00:00`,
      lmp: Number(avgLMP.toFixed(2)),
      energy: Number(avgEnergy.toFixed(2)),
      congestion: Number(avgCongestion.toFixed(2)),
      loss: Number(avgLoss.toFixed(2)),
    });
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

  const apiKey = process.env.GRID_API_KEY;
  if (!apiKey) {
    throw new Error("GRID_API_KEY not configured");
  }

  // Parse date and construct time range (00:00 to 23:59 UTC)
  const startTime = `${date}T00:00:00Z`;
  const endTime = `${date}T23:59:59Z`;

  // Use server-side filtering by location for efficiency
  const locationFilter = `&filter_column=location&filter_value=${encodeURIComponent(node)}`;
  
  // For sub-hourly datasets (15-min, 5-min), use API resampling to hourly
  const needsResampling = ['CAISO', 'CISO', 'ERCOT', 'ERCO', 'SPP', 'SWPP'].includes(isoUpper);
  const resampleParams = needsResampling
    ? '&resample_frequency=1 hour&resample_by=location&resample_function=mean'
    : '';

  const url = `${GRID_STATUS_BASE}/datasets/${datasetId}/query?start_time=${startTime}&end_time=${endTime}${locationFilter}${resampleParams}&limit=100`;

  console.log('Fetching LMP data:', { iso, node, date, needsResampling });

  const response = await fetch(url, {
    headers: {
      "x-api-key": apiKey,
    },
    signal: AbortSignal.timeout(30000), // 30 second timeout
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Grid Status API error:', response.status, errorText);
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
  const lmpData: LMPDataPoint[] = filteredData.map((d) => ({
    time: d.interval_start_utc,
    lmp: d.lmp,
    energy: d.energy,
    congestion: d.congestion,
    loss: d.loss,
  }));

  // Sort by time
  lmpData.sort((a, b) => a.time.localeCompare(b.time));

  return lmpData;
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
