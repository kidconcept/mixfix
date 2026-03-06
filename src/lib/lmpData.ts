import { LMPDataPoint } from "@/types/energy";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GRID_STATUS_BASE = "https://api.gridstatus.io/v1";

// Mapping ISO names to Grid Status LMP dataset IDs
const ISO_LMP_DATASET_MAP: Record<string, string> = {
  NYISO: "nyiso_lmp_real_time_hourly",
  NYIS: "nyiso_lmp_real_time_hourly",
  CAISO: "caiso_lmp_real_time_hourly",
  CISO: "caiso_lmp_real_time_hourly",
  ERCOT: "ercot_lmp_real_time_hourly",
  ERCO: "ercot_lmp_real_time_hourly",
  ISONE: "isone_lmp_real_time_hourly",
  ISNE: "isone_lmp_real_time_hourly",
  MISO: "miso_lmp_real_time_hourly",
  PJM: "pjm_lmp_real_time_hourly",
  SPP: "spp_lmp_real_time_hourly",
  SWPP: "spp_lmp_real_time_hourly",
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
// Public API Functions
// ---------------------------------------------------------------------------

/**
 * Check if an ISO is supported for LMP data via Grid Status
 */
export function isLMPSupported(iso: string): boolean {
  return iso.toUpperCase() in ISO_LMP_DATASET_MAP;
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

  const url = `${GRID_STATUS_BASE}/datasets/${datasetId}/query?start_time=${startTime}&end_time=${endTime}&limit=50000`;

  const response = await fetch(url, {
    headers: {
      "x-api-key": apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Grid Status API error: ${response.status} ${response.statusText}`
    );
  }

  const json: GridStatusLMPResponse = await response.json();

  // Filter for the specific node and convert to hourly data
  const nodeData = json.data.filter(
    (d) => d.location.toUpperCase() === node.toUpperCase()
  );

  // Map to our LMP format
  const lmpData: LMPDataPoint[] = nodeData.map((d) => ({
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
