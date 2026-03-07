/**
 * Script to analyze raw Grid Status API responses for all fuel types
 */

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

const KNOWN_FUEL_TYPES = new Set([
  'solar', 'wind', 'hydro', 'nuclear', 'gas', 'coal', 'oil', 'other',
  'natural_gas', 'dual_fuel', 'other_fossil_fuels', 'other_renewables',
  // Timestamps and metadata fields
  'interval_start_utc', 'interval_end_utc', 'interval_start', 'interval_end',
  'publish_time', 'created_at', 'last_updated'
]);

const MAPPED_TYPES = new Set([
  'solar', 'wind', 'hydro', 'nuclear', 'gas', 'coal', 'oil', 'other',
  'natural_gas', 'dual_fuel', 'other_fossil_fuels', 'other_renewables'
]);

interface FuelTypeStats {
  region: string;
  maxValue: number;
  maxHour: string;
  totalGeneration: number;
  percentage: number;
  sampleCount: number;
}

async function fetchRawData(dataset: string, date: string) {
  const apiKey = process.env.GRID_API_KEY;
  if (!apiKey) {
    throw new Error("GRID_API_KEY not configured");
  }

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

function analyzeDataPoint(dataPoint: any): { fields: string[], values: Record<string, number> } {
  const fields: string[] = [];
  const values: Record<string, number> = {};

  for (const [key, value] of Object.entries(dataPoint)) {
    if (typeof value === 'number' && !key.includes('time') && !key.includes('created') && !key.includes('updated')) {
      fields.push(key);
      values[key] = value;
    }
  }

  return { fields, values };
}

async function analyzeRegion(region: { name: string, dataset: string }, date: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Analyzing ${region.name}`);
  console.log('='.repeat(60));

  try {
    const response = await fetchRawData(region.dataset, date);
    
    if (!response.data || response.data.length === 0) {
      console.log(`❌ No data returned for ${region.name}`);
      return { region: region.name, allFields: new Set<string>(), unmappedFields: new Set<string>(), stats: {} };
    }

    const allFields = new Set<string>();
    const unmappedFields = new Set<string>();
    const fieldStats: Record<string, { max: number, maxTime: string, total: number, count: number, samples: number[] }> = {};

    // Aggregate to hourly (take one sample per hour)
    const hourlyData: Record<number, any> = {};
    
    for (const point of response.data) {
      const timestamp = new Date(point.interval_start_utc);
      const hour = timestamp.getUTCHours();
      const minute = timestamp.getUTCMinutes();

      // Take the point closest to the top of the hour
      if (!hourlyData[hour] || minute <= 5) {
        hourlyData[hour] = point;
      }
    }

    console.log(`\n📊 Data Points: ${response.data.length} raw, ${Object.keys(hourlyData).length} hourly samples`);

    // Analyze hourly samples
    for (let hour = 0; hour < 24; hour++) {
      const dataPoint = hourlyData[hour];
      if (!dataPoint) continue;

      const { fields, values } = analyzeDataPoint(dataPoint);

      for (const field of fields) {
        allFields.add(field);
        
        if (!KNOWN_FUEL_TYPES.has(field)) {
          unmappedFields.add(field);
        }

        if (!fieldStats[field]) {
          fieldStats[field] = { max: 0, maxTime: '', total: 0, count: 0, samples: [] };
        }

        const value = values[field];
        fieldStats[field].total += value;
        fieldStats[field].count++;
        fieldStats[field].samples.push(value);

        if (value > fieldStats[field].max) {
          fieldStats[field].max = value;
          fieldStats[field].maxTime = dataPoint.interval_start_utc;
        }
      }
    }

    console.log(`\n🔍 All Fuel Type Fields (${allFields.size}):`);
    const sortedFields = Array.from(allFields).sort();
    for (const field of sortedFields) {
      const isMapped = MAPPED_TYPES.has(field);
      const stats = fieldStats[field];
      const avg = stats.count > 0 ? stats.total / stats.count : 0;
      console.log(`  ${isMapped ? '✅' : '❌'} ${field.padEnd(25)} Max: ${stats.max.toFixed(1)} MW, Avg: ${avg.toFixed(1)} MW`);
    }

    if (unmappedFields.size > 0) {
      console.log(`\n⚠️  Unmapped Fields (${unmappedFields.size}):`);
      for (const field of Array.from(unmappedFields).sort()) {
        const stats = fieldStats[field];
        console.log(`  - ${field}: max ${stats.max.toFixed(1)} MW`);
      }
    } else {
      console.log(`\n✅ All fields are mapped!`);
    }

    return { 
      region: region.name, 
      allFields, 
      unmappedFields, 
      stats: fieldStats 
    };

  } catch (error) {
    console.log(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    return { region: region.name, allFields: new Set<string>(), unmappedFields: new Set<string>(), stats: {} };
  }
}

async function main() {
  const date = "2024-03-01"; // Use a recent date

  console.log('='.repeat(60));
  console.log('GRID STATUS API FUEL TYPE ANALYSIS');
  console.log('='.repeat(60));
  console.log(`Date: ${date}`);
  console.log(`Regions: ${REGIONS.length}`);

  const results = [];

  for (const region of REGIONS) {
    const result = await analyzeRegion(region, date);
    results.push(result);
    // Small delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Global summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('GLOBAL SUMMARY');
  console.log('='.repeat(60));

  const globalUnmapped = new Set<string>();
  const globalFields = new Set<string>();

  for (const result of results) {
    for (const field of result.unmappedFields) {
      globalUnmapped.add(field);
    }
    for (const field of result.allFields) {
      globalFields.add(field);
    }
  }

  console.log(`\nTotal unique fields across all regions: ${globalFields.size}`);
  console.log(`Currently mapped fuel types: ${MAPPED_TYPES.size}`);
  console.log(`Unmapped fields found: ${globalUnmapped.size}`);

  if (globalUnmapped.size > 0) {
    console.log(`\n⚠️  Fields missing from theme:`);
    for (const field of Array.from(globalUnmapped).sort()) {
      const regionsWithField = results.filter(r => r.unmappedFields.has(field)).map(r => r.region);
      console.log(`  - ${field} (in ${regionsWithField.join(', ')})`);
    }
  }

  // Find highest values for each unmapped field
  if (globalUnmapped.size > 0) {
    console.log(`\n${'='.repeat(60)}`);
    console.log('PEAK VALUES FOR UNMAPPED FUEL TYPES');
    console.log('='.repeat(60));

    for (const field of Array.from(globalUnmapped).sort()) {
      let maxValue = 0;
      let maxRegion = '';
      let maxHour = '';
      let maxTotal = 0;

      for (const result of results) {
        if (result.stats[field]) {
          const stats = result.stats[field];
          if (stats.max > maxValue) {
            maxValue = stats.max;
            maxRegion = result.region;
            maxHour = stats.maxTime;
            // Calculate total generation at that hour
            maxTotal = Object.entries(result.stats)
              .filter(([key]) => !key.includes('time') && !key.includes('created'))
              .reduce((sum, [_, s]) => sum + (s.max || 0), 0);
          }
        }
      }

      if (maxValue > 0) {
        const percentage = maxTotal > 0 ? (maxValue / maxTotal * 100) : 0;
        console.log(`\n${field}:`);
        console.log(`  Peak Region:  ${maxRegion}`);
        console.log(`  Peak Value:   ${maxValue.toFixed(1)} MW`);
        console.log(`  Peak Time:    ${maxHour}`);
        console.log(`  % of Mix:     ${percentage.toFixed(2)}%`);
      }
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('Analysis Complete!');
  console.log(`${'='.repeat(60)}\n`);
}

main().catch(console.error);
