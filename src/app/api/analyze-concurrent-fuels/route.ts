import { NextResponse } from "next/server";

const GRID_STATUS_BASE = "https://api.gridstatus.io/v1";

const REGIONS = [
  { name: "NYISO", dataset: "nyiso_fuel_mix" },
  { name: "CAISO", dataset: "caiso_fuel_mix" },
  { name: "ERCOT", dataset: "ercot_fuel_mix" },
  { name: "ISONE", dataset: "isone_fuel_mix" },
  { name: "MISO", dataset: "miso_fuel_mix" },
  { name: "PJM", dataset: "pjm_fuel_mix" },
  { name: "SPP", dataset: "spp_fuel_mix" },
];

const KNOWN_METADATA_FIELDS = new Set([
  'interval_start_utc', 'interval_end_utc', 'interval_start', 'interval_end',
  'publish_time', 'created_at', 'last_updated', 'time', 'timestamp'
]);

async function fetchRawData(dataset: string, date: string, apiKey: string) {
  const startTime = `${date}T00:00:00Z`;
  const endTime = `${date}T23:59:59Z`;
  const url = `${GRID_STATUS_BASE}/datasets/${dataset}/query?start_time=${startTime}&end_time=${endTime}`;

  const res = await fetch(url, {
    headers: {
      "x-api-key": apiKey,
    },
  });

  if (!res.ok) {
    throw new Error(`Grid Status API error ${res.status} for ${dataset}`);
  }

  return res.json();
}

function countActiveFuels(dataPoint: any): { count: number, types: string[] } {
  const activeTypes: string[] = [];

  for (const [key, value] of Object.entries(dataPoint)) {
    if (typeof value === 'number' && !KNOWN_METADATA_FIELDS.has(key) && value > 0) {
      activeTypes.push(key);
    }
  }

  return { count: activeTypes.length, types: activeTypes.sort() };
}

async function analyzeRegion(region: { name: string, dataset: string }, date: string, apiKey: string) {
  try {
    const response = await fetchRawData(region.dataset, date, apiKey);
    
    if (!response.data || response.data.length === 0) {
      return { 
        region: region.name, 
        error: "No data",
        concurrentStats: null
      };
    }

    // Aggregate to hourly
    const hourlyData: Record<number, any> = {};
    
    for (const point of response.data) {
      const timestamp = new Date(point.interval_start_utc);
      const hour = timestamp.getUTCHours();
      const minute = timestamp.getUTCMinutes();

      if (!hourlyData[hour] || minute <= 5) {
        hourlyData[hour] = point;
      }
    }

    // Count concurrent fuel types for each hour
    const hourlyConcurrentCounts: number[] = [];
    const hourlyActiveFuels: { hour: number, count: number, types: string[] }[] = [];
    
    for (let hour = 0; hour < 24; hour++) {
      const dataPoint = hourlyData[hour];
      if (!dataPoint) continue;

      const { count, types } = countActiveFuels(dataPoint);
      hourlyConcurrentCounts.push(count);
      
      // Store details for min/max hours
      hourlyActiveFuels.push({
        hour,
        count,
        types
      });
    }

    // Calculate statistics
    const minConcurrent = Math.min(...hourlyConcurrentCounts);
    const maxConcurrent = Math.max(...hourlyConcurrentCounts);
    const avgConcurrent = hourlyConcurrentCounts.reduce((a, b) => a + b, 0) / hourlyConcurrentCounts.length;
    const medianConcurrent = hourlyConcurrentCounts.sort((a, b) => a - b)[Math.floor(hourlyConcurrentCounts.length / 2)];

    // Find hours with min/max concurrent types
    const minHour = hourlyActiveFuels.find(h => h.count === minConcurrent);
    const maxHour = hourlyActiveFuels.find(h => h.count === maxConcurrent);

    // Count all unique fuel types that appeared at least once
    const allFuelTypes = new Set<string>();
    for (const h of hourlyActiveFuels) {
      h.types.forEach(t => allFuelTypes.add(t));
    }

    return { 
      region: region.name,
      concurrentStats: {
        minConcurrent,
        maxConcurrent,
        avgConcurrent: Math.round(avgConcurrent * 10) / 10,
        medianConcurrent,
        totalUniqueFuelTypes: allFuelTypes.size,
        minHourDetails: minHour,
        maxHourDetails: maxHour,
        allFuelTypes: Array.from(allFuelTypes).sort()
      }
    };

  } catch (error) {
    return { 
      region: region.name, 
      error: error instanceof Error ? error.message : String(error),
      concurrentStats: null
    };
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") || "2024-03-01";

  const apiKey = process.env.GRID_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GRID_API_KEY not configured" }, { status: 500 });
  }

  try {
    const results = [];

    for (const region of REGIONS) {
      const result = await analyzeRegion(region, date, apiKey);
      results.push(result);
      // Delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Global statistics
    const successfulRegions = results.filter(r => r.concurrentStats);
    const globalMin = Math.min(...successfulRegions.map(r => r.concurrentStats!.minConcurrent));
    const globalMax = Math.max(...successfulRegions.map(r => r.concurrentStats!.maxConcurrent));
    const globalAvg = successfulRegions.reduce((sum, r) => sum + r.concurrentStats!.avgConcurrent, 0) / successfulRegions.length;

    return NextResponse.json({
      date,
      summary: {
        totalRegionsAnalyzed: successfulRegions.length,
        globalMinConcurrent: globalMin,
        globalMaxConcurrent: globalMax,
        globalAvgConcurrent: Math.round(globalAvg * 10) / 10,
        interpretation: `Across all regions, between ${globalMin} and ${globalMax} fuel types are active at any given hour (avg: ${Math.round(globalAvg * 10) / 10})`
      },
      regions: results
    });

  } catch (err) {
    const error = err as Error;
    console.error("Analysis error:", error.message);
    return NextResponse.json(
      { error: "Failed to analyze concurrent fuel types", details: error.message },
      { status: 500 }
    );
  }
}
