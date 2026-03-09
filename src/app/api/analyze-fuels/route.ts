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

const MAPPED_TYPES = new Set([
  'solar', 'wind', 'hydro', 'nuclear', 'gas', 'coal', 'oil', 'other',
  'natural_gas', 'dual_fuel', 'other_fossil_fuels', 'other_renewables'
]);

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

function analyzeDataPoint(dataPoint: any): string[] {
  const fields: string[] = [];

  for (const [key, value] of Object.entries(dataPoint)) {
    if (typeof value === 'number' && !KNOWN_METADATA_FIELDS.has(key)) {
      fields.push(key);
    }
  }

  return fields;
}

async function analyzeRegion(region: { name: string, dataset: string }, date: string, apiKey: string) {
  try {
    const response = await fetchRawData(region.dataset, date, apiKey);
    
    if (!response.data || response.data.length === 0) {
      return { 
        region: region.name, 
        error: "No data",
        allFields: [],
        unmappedFields: [],
        stats: {}
      };
    }

    const allFields = new Set<string>();
    const unmappedFields = new Set<string>();
    const fieldStats: Record<string, { max: number, maxTime: string, total: number, count: number }> = {};

    // Aggregate to hourly (take one sample per hour)
    const hourlyData: Record<number, any> = {};
    
    for (const point of response.data) {
      const timestamp = new Date(point.interval_start_utc);
      const hour = timestamp.getUTCHours();
      const minute = timestamp.getUTCMinutes();

      if (!hourlyData[hour] || minute <= 5) {
        hourlyData[hour] = point;
      }
    }

    // Analyze hourly samples
    for (let hour = 0; hour < 24; hour++) {
      const dataPoint = hourlyData[hour];
      if (!dataPoint) continue;

      const fields = analyzeDataPoint(dataPoint);

      for (const field of fields) {
        allFields.add(field);
        
        if (!MAPPED_TYPES.has(field)) {
          unmappedFields.add(field);
        }

        if (!fieldStats[field]) {
          fieldStats[field] = { max: 0, maxTime: '', total: 0, count: 0 };
        }

        const value = dataPoint[field] as number;
        fieldStats[field].total += value;
        fieldStats[field].count++;

        if (value > fieldStats[field].max) {
          fieldStats[field].max = value;
          fieldStats[field].maxTime = dataPoint.interval_start_utc;
          
          // Store total generation at this hour for percentage calculation
          (fieldStats[field] as any).totalAtMax = Object.entries(dataPoint)
            .filter(([key, val]) => typeof val === 'number' && !KNOWN_METADATA_FIELDS.has(key))
            .reduce((sum, [_, val]) => sum + (val as number), 0);
        }
      }
    }

    return { 
      region: region.name,
      dataPoints: response.data.length,
      hourlyDataPoints: Object.keys(hourlyData).length,
      allFields: Array.from(allFields).sort(), 
      unmappedFields: Array.from(unmappedFields).sort(), 
      stats: fieldStats 
    };

  } catch (error) {
    return { 
      region: region.name, 
      error: error instanceof Error ? error.message : String(error),
      allFields: [],
      unmappedFields: [],
      stats: {}
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

    // Global summary
    const globalUnmapped = new Set<string>();
    const globalFields = new Set<string>();

    for (const result of results) {
      for (const field of result.unmappedFields || []) {
        globalUnmapped.add(field);
      }
      for (const field of result.allFields || []) {
        globalFields.add(field);
      }
    }

    // Find peak values for unmapped fields
    const unmappedPeaks: Record<string, any> = {};

    for (const field of Array.from(globalUnmapped).sort()) {
      let maxValue = 0;
      let maxRegion = '';
      let maxHour = '';
      let totalAtMax = 0;

      for (const result of results) {
        const statsMap = result.stats as Record<string, { max: number; maxTime: string; total: number; count: number; totalAtMax?: number }>;
        if (statsMap[field]) {
          const stats = statsMap[field];
          if (stats.max > maxValue) {
            maxValue = stats.max;
            maxRegion = result.region;
            maxHour = stats.maxTime;
            totalAtMax = stats.totalAtMax || 0;
          }
        }
      }

      if (maxValue > 0) {
        const percentage = totalAtMax > 0 ? (maxValue / totalAtMax * 100) : 0;
        unmappedPeaks[field] = {
          peakRegion: maxRegion,
          peakValue: Math.round(maxValue),
          peakValueGW: (maxValue / 1000).toFixed(3),
          peakTime: maxHour,
          totalAtPeak: Math.round(totalAtMax),
          percentageOfMix: percentage.toFixed(2)
        };
      }
    }

    return NextResponse.json({
      date,
      totalRegions: REGIONS.length,
      totalMappedTypes: MAPPED_TYPES.size,
      totalFieldsFound: globalFields.size,
      totalUnmappedFields: globalUnmapped.size,
      mappedTypes: Array.from(MAPPED_TYPES).sort(),
      unmappedTypes: Array.from(globalUnmapped).sort(),
      unmappedPeaks,
      regionDetails: results
    });

  } catch (err) {
    const error = err as Error;
    console.error("Analysis error:", error.message);
    return NextResponse.json(
      { error: "Failed to analyze fuel types", details: error.message },
      { status: 500 }
    );
  }
}
