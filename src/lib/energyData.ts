import { EnergySource, HistoricalRecord } from "@/types/energy";
import { SOURCE_COLORS } from "./theme";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Re-export SOURCE_COLORS from centralized theme
export { SOURCE_COLORS };

const EIA_BASE = "https://api.eia.gov/v2";
const EIA_RTO_ENDPOINT = `${EIA_BASE}/electricity/rto/fuel-type-data/data/`;

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

// ---------------------------------------------------------------------------
// EIA helpers
// ---------------------------------------------------------------------------

type EIARow = { 
  period: string;
  respondent: string;
  fueltype: string; 
  "type-name": string; 
  value: number 
};

async function eiaFetch(params: URLSearchParams): Promise<EIARow[]> {
  const url = `${EIA_RTO_ENDPOINT}?${params}`;
  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) {
    throw new Error(`EIA API error ${res.status} at ${url}`);
  }
  const json = await res.json();
  return (json.response?.data ?? []) as EIARow[];
}

function buildBaseParams(apiKey: string): URLSearchParams {
  const p = new URLSearchParams();
  p.set("api_key", apiKey);
  p.append("data[0]", "value");
  p.set("frequency", "hourly");
  p.set("sort[0][column]", "period");
  p.set("sort[0][direction]", "asc");
  return p;
}

// Mapping for balancing authorities (ISOs/RTOs)
const BALANCING_AUTHORITY_MAP: Record<string, string> = {
  NYISO: "NYIS",
  NYIS: "NYIS",
  CAISO: "CISO",
  CISO: "CISO",
  PJM: "PJM",
  MISO: "MISO",
  ERCOT: "ERCO",
  ERCO: "ERCO",
  SPP: "SWPP",
  SWPP: "SWPP",
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function fetchEIAHourly(
  location: string | null,
  date: string // YYYY-MM-DD
): Promise<HistoricalRecord[]> {
  const apiKey = process.env.EIA_API_KEY;
  if (!apiKey) return getMockHourly(date);

  const p = buildBaseParams(apiKey);
  p.set("start", `${date}T00`);
  p.set("end", `${date}T23`);
  p.set("length", "200"); // Strict limit: max ~8 fuel types × 24 hours = 192 rows

  if (location) {
    const upperLoc = location.toUpperCase();
    // Check if it's a balancing authority first
    if (BALANCING_AUTHORITY_MAP[upperLoc]) {
      p.append("facets[respondent][]", BALANCING_AUTHORITY_MAP[upperLoc]);
    } else if (upperLoc.length === 2) {
      // Otherwise treat as state code
      p.append("facets[stateid][]", upperLoc);
    }
  }

  const rows = await eiaFetch(p);
  if (!rows.length) return getMockHourly(date);

  const hourlyData: { [hour: string]: HistoricalRecord } = {};

  for (const row of rows) {
    const hour = row.period;
    
    // Safety check: only process hours within the requested date
    // This prevents unbounded growth if API returns unexpected data
    if (!hour || !hour.startsWith(date)) {
      continue;
    }
    
    // Additional safety: limit to reasonable number of hours (max 24 per day)
    if (Object.keys(hourlyData).length >= 24 && !hourlyData[hour]) {
      continue;
    }
    
    if (!hourlyData[hour]) {
      hourlyData[hour] = { date: hour };
    }
    const source: EnergySource = FUELTYPEID_MAP[row.fueltype] ?? "other";
    // Value is in MWh. Convert to GW for the hour.
    const currentValue = hourlyData[hour][source] as number || 0;
    hourlyData[hour][source] = currentValue + (row.value / 1000);
  }

  return Object.values(hourlyData);
}

// ---------------------------------------------------------------------------
// Mock fallback (used when EIA_API_KEY is not set)
// ---------------------------------------------------------------------------

export function getMockHourly(date: string): HistoricalRecord[] {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  return hours.map(hour => {
    const timestamp = `${date}T${String(hour).padStart(2, '0')}:00:00`;
    return {
      date: timestamp,
      solar: Math.max(0, Math.sin((hour - 6) * Math.PI / 12) * 150),
      wind: 180 + Math.random() * 40 - 20,
      hydro: 110,
      nuclear: 85,
      gas: 200 - Math.sin((hour - 6) * Math.PI / 12) * 50,
      coal: 120,
      oil: 17,
      other: 9,
    };
  });
}

