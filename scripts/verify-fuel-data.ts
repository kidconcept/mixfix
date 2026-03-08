/**
 * Fuel Mix Data Verification Script
 * 
 * Verifies fuel mix data integrity by:
 * 1. Making direct EIA API call with same parameters as app
 * 2. Making request to /api/energy endpoint
 * 3. Comparing responses field-by-field
 * 4. Checking consistency across multiple requests
 * 5. Detecting mock data patterns
 * 
 * Usage:
 *   npx tsx scripts/verify-fuel-data.ts <BA_CODE> <DATE>
 *   
 * Examples:
 *   npx tsx scripts/verify-fuel-data.ts NYISO 2026-03-06
 *   npx tsx scripts/verify-fuel-data.ts CAISO 2024-03-01
 *   npx tsx scripts/verify-fuel-data.ts CA 2026-03-05  (state code)
 * 
 * Options:
 *   --consistency=<N>  Run N consistency checks (default: 3)
 *   --verbose         Show detailed comparison output
 * 
 * Requirements:
 *   - EIA_API_KEY must be set in .env.local
 *   - Development server should be running on localhost:3000
 */

import * as fs from 'fs';
import * as path from 'path';

// Load environment variables from .env.local
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^["']|["']$/g, '');
      process.env[key] = value;
    }
  });
}

// Import BA config
const configPath = path.join(process.cwd(), 'config', 'balancing-authorities.json');
const BA_CONFIG = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};

const EIA_BASE = "https://api.eia.gov/v2";
const EIA_ENDPOINT = `${EIA_BASE}/electricity/rto/fuel-type-data/data/`;

// Fuel type mapping (same as in app)
const FUEL_MAP: Record<string, string> = {
  COL: 'coal',
  NG: 'gas',
  NUC: 'nuclear',
  WAT: 'hydro',
  SUN: 'solar',
  WND: 'wind',
  OIL: 'oil',
  OTH: 'other',
};

interface EIARow {
  period: string;
  respondent: string;
  fueltype: string;
  value: number;
}

interface HourlyRecord {
  date: string;
  [key: string]: number | string;
}

interface ComparisonResult {
  match: boolean;
  recordCount: { direct: number; app: number };
  mismatches: Array<{ hour: string; fuel: string; direct: number; app: number; diff: number }>;
  missingInDirect: string[];
  missingInApp: string[];
  isMockData: boolean;
  mockPatterns: string[];
}

// Get EIA code mapping (same logic as app)
function getEIACode(location: string): string | null {
  const upper = location.toUpperCase();
  
  // Check if it exists in the config
  if (BA_CONFIG[upper]) {
    return BA_CONFIG[upper].eiaCode || upper;
  }
  
  return null;
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  
  if (args.length < 2 || args.some(arg => arg === '--help' || arg === '-h')) {
    console.log(`
Usage: npx tsx scripts/verify-fuel-data.ts <BA_CODE> <DATE> [OPTIONS]

Arguments:
  BA_CODE    Balancing Authority code (e.g., NYISO, CAISO) or 2-letter state code
  DATE       Date in YYYY-MM-DD format

Options:
  --consistency=N    Run N consistency checks (default: 3)
  --verbose          Show detailed comparison output
  --help, -h         Show this help message

Examples:
  npx tsx scripts/verify-fuel-data.ts NYISO 2026-03-06
  npx tsx scripts/verify-fuel-data.ts CAISO 2024-03-01 --verbose
  npx tsx scripts/verify-fuel-data.ts CA 2026-03-05 --consistency=5
`);
    process.exit(0);
  }
  
  const location = args[0];
  const date = args[1];
  
  let consistencyChecks = 3;
  let verbose = false;
  
  for (const arg of args.slice(2)) {
    if (arg.startsWith('--consistency=')) {
      consistencyChecks = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--verbose') {
      verbose = true;
    }
  }
  
  return { location, date, consistencyChecks, verbose };
}

// Make direct EIA API call
async function fetchDirectEIA(location: string, date: string): Promise<HourlyRecord[]> {
  const apiKey = process.env.EIA_API_KEY;
  
  if (!apiKey) {
    throw new Error('EIA_API_KEY not set in .env.local');
  }
  
  // Build query params (same logic as app)
  const [year, month, day] = date.split('-').map(Number);
  const nextDate = new Date(year, month - 1, day + 1);
  const nextDayStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`;
  
  const params = new URLSearchParams({
    'api_key': apiKey,
    'data[0]': 'value',
    'frequency': 'hourly',
    'start': `${date}T00`,
    'end': `${nextDayStr}T00`,
    'sort[0][column]': 'period',
    'sort[0][direction]': 'asc',
  });
  
  // Add location facet
  const upperLoc = location.toUpperCase();
  const eiaCode = getEIACode(upperLoc);
  
  if (eiaCode) {
    params.append('facets[respondent][]', eiaCode);
    console.log(`[Direct EIA] Using BA mapping: ${location} → respondent=${eiaCode}`);
  } else if (upperLoc.length === 2) {
    params.append('facets[stateid][]', upperLoc);
    console.log(`[Direct EIA] Using state code: ${location} → stateid=${upperLoc}`);
  } else {
    throw new Error(`Unknown location format: ${location} (not in BA config, not a 2-letter state code)`);
  }
  
  const url = `${EIA_ENDPOINT}?${params}`;
  console.log(`[Direct EIA] Request URL: ${url.substring(0, 200)}...`);
  
  const response = await fetch(url);
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`EIA API error: ${response.status} ${response.statusText}\n${text}`);
  }
  
  const json = await response.json();
  const rows: EIARow[] = json.response?.data ?? [];
  
  console.log(`[Direct EIA] Received ${rows.length} raw rows`);
  
  // Transform to hourly records (same logic as app)
  return transformEIAData(rows, date);
}

// Transform EIA rows to hourly records (same as app logic)
function transformEIAData(rows: EIARow[], date: string): HourlyRecord[] {
  const hourlyMap = new Map<string, Map<string, number>>();
  
  // Calculate next day for hour 24 mapping
  const [year, month, day] = date.split('-').map(Number);
  const nextDate = new Date(year, month - 1, day + 1);
  const nextDayStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`;
  
  for (const row of rows) {
    let hour = row.period;
    
    // Handle hour 24
    if (hour && hour.includes('T24')) {
      hour = hour.replace('T24', 'T00');
      const datePart = hour.split('T')[0];
      if (datePart === date) {
        hour = `${nextDayStr}T00`;
      }
    }
    
    // Only include hours within requested date
    if (!hour?.startsWith(date)) continue;
    
    const fuelType = FUEL_MAP[row.fueltype];
    if (!fuelType) continue;
    
    if (!hourlyMap.has(hour)) {
      hourlyMap.set(hour, new Map());
    }
    
    const fuelMap = hourlyMap.get(hour)!;
    const currentValue = fuelMap.get(fuelType) || 0;
    fuelMap.set(fuelType, currentValue + row.value / 1000); // MWh to GW
  }
  
  // Convert to array and sort
  const records: HourlyRecord[] = [];
  const sortedHours = Array.from(hourlyMap.keys()).sort();
  
  for (const hour of sortedHours) {
    const fuelMap = hourlyMap.get(hour)!;
    const record: HourlyRecord = { date: hour };
    
    for (const [fuel, value] of fuelMap.entries()) {
      record[fuel] = Math.round(value * 1000) / 1000; // Round to 3 decimals
    }
    
    records.push(record);
  }
  
  return records;
}

// Fetch from app API
async function fetchAppAPI(location: string, date: string): Promise<{ hourly: HourlyRecord[]; meta: any }> {
  const url = `http://localhost:3000/api/energy?location=${location}&date=${date}`;
  console.log(`[App API] Request URL: ${url}`);
  
  const response = await fetch(url);
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`App API error: ${response.status} ${response.statusText}\n${text}`);
  }
  
  const data = await response.json();
  console.log(`[App API] Received ${data.hourly?.length || 0} hourly records`);
  console.log(`[App API] Metadata:`, data.meta);
  
  return data;
}

// Compare two datasets
function compareData(direct: HourlyRecord[], app: HourlyRecord[], verbose: boolean): ComparisonResult {
  const result: ComparisonResult = {
    match: true,
    recordCount: { direct: direct.length, app: app.length },
    mismatches: [],
    missingInDirect: [],
    missingInApp: [],
    isMockData: false,
    mockPatterns: [],
  };
  
  // Check record count
  if (direct.length !== app.length) {
    result.match = false;
    console.log(`❌ Record count mismatch: Direct=${direct.length}, App=${app.length}`);
  }
  
  // Build maps for comparison
  const directMap = new Map(direct.map(r => [r.date, r]));
  const appMap = new Map(app.map(r => [r.date, r]));
  
  // Check for missing hours
  for (const record of direct) {
    if (!appMap.has(record.date)) {
      result.missingInApp.push(record.date);
    }
  }
  
  for (const record of app) {
    if (!directMap.has(record.date)) {
      result.missingInDirect.push(record.date);
    }
  }
  
  // Compare values for matching hours
  const tolerance = 0.001; // Allow 0.001 GW difference (rounding tolerance)
  
  for (const [hour, directRecord] of directMap.entries()) {
    const appRecord = appMap.get(hour);
    if (!appRecord) continue;
    
    // Get all fuel types from both records
    const allFuels = new Set([
      ...Object.keys(directRecord).filter(k => k !== 'date'),
      ...Object.keys(appRecord).filter(k => k !== 'date'),
    ]);
    
    for (const fuel of allFuels) {
      const directVal = typeof directRecord[fuel] === 'number' ? directRecord[fuel] as number : 0;
      const appVal = typeof appRecord[fuel] === 'number' ? appRecord[fuel] as number : 0;
      const diff = Math.abs(directVal - appVal);
      
      if (diff > tolerance) {
        result.match = false;
        result.mismatches.push({
          hour,
          fuel,
          direct: directVal,
          app: appVal,
          diff,
        });
      }
    }
  }
  
  // Detect mock data patterns
  result.isMockData = detectMockData(app, result.mockPatterns);
  
  return result;
}

// Detect mock data patterns
function detectMockData(records: HourlyRecord[], patterns: string[]): boolean {
  if (records.length < 10) return false;
  
  let isMock = false;
  
  // Check for constant nuclear/coal/hydro (typical in mock data)
  const nuclearValues = records.map(r => typeof r.nuclear === 'number' ? r.nuclear : 0).filter(v => v > 0);
  const coalValues = records.map(r => typeof r.coal === 'number' ? r.coal : 0).filter(v => v > 0);
  const hydroValues = records.map(r => typeof r.hydro === 'number' ? r.hydro : 0).filter(v => v > 0);
  
  if (nuclearValues.length > 5) {
    const nuclearStd = Math.sqrt(nuclearValues.reduce((sum, v) => sum + Math.pow(v - nuclearValues.reduce((s, x) => s + x, 0) / nuclearValues.length, 2), 0) / nuclearValues.length);
    if (nuclearStd < 0.01) {
      patterns.push(`Constant nuclear values (${nuclearValues[0].toFixed(1)} GW, σ=${nuclearStd.toFixed(4)})`);
      isMock = true;
    }
  }
  
  if (coalValues.length > 5) {
    const coalStd = Math.sqrt(coalValues.reduce((sum, v) => sum + Math.pow(v - coalValues.reduce((s, x) => s + x, 0) / coalValues.length, 2), 0) / coalValues.length);
    if (coalStd < 0.01) {
      patterns.push(`Constant coal values (${coalValues[0].toFixed(1)} GW, σ=${coalStd.toFixed(4)})`);
      isMock = true;
    }
  }
  
  if (hydroValues.length > 5) {
    const hydroStd = Math.sqrt(hydroValues.reduce((sum, v) => sum + Math.pow(v - hydroValues.reduce((s, x) => s + x, 0) / hydroValues.length, 2), 0) / hydroValues.length);
    if (hydroStd < 0.01) {
      patterns.push(`Constant hydro values (${hydroValues[0].toFixed(1)} GW, σ=${hydroStd.toFixed(4)})`);
      isMock = true;
    }
  }
  
  // Check for sinusoidal solar pattern (typical mock)
  const solarValues = records.map(r => typeof r.solar === 'number' ? r.solar : 0);
  if (solarValues.length === 24) {
    const midnightSolar = solarValues[0];
    const noonSolar = solarValues[12];
    
    if (midnightSolar === 0 && noonSolar > 0) {
      // Check if it follows smooth curve
      let smoothness = 0;
      for (let i = 1; i < solarValues.length - 1; i++) {
        const derivative = Math.abs((solarValues[i + 1] - solarValues[i]) - (solarValues[i] - solarValues[i - 1]));
        smoothness += derivative;
      }
      
      if (smoothness < 1.0) {
        patterns.push(`Perfect solar curve (smoothness=${smoothness.toFixed(2)})`);
        isMock = true;
      }
    }
  }
  
  return isMock;
}

// Calculate data fingerprint for consistency checking
function calculateFingerprint(records: HourlyRecord[]): string {
  if (records.length === 0) return 'EMPTY';
  
  const totalGeneration = records.reduce((sum, record) => {
    const recordTotal = Object.entries(record)
      .filter(([key]) => key !== 'date')
      .reduce((acc, [, val]) => acc + (typeof val === 'number' ? val : 0), 0);
    return sum + recordTotal;
  }, 0);
  
  const first = records[0];
  const last = records[records.length - 1];
  
  return `${records.length}h:${Math.round(totalGeneration)}GW:${first.date}-${last.date}`;
}

// Main verification
async function main() {
  const { location, date, consistencyChecks, verbose } = parseArgs();
  
  console.log('\n='.repeat(80));
  console.log('FUEL MIX DATA VERIFICATION');
  console.log('='.repeat(80));
  console.log(`Location: ${location}`);
  console.log(`Date: ${date}`);
  console.log(`Consistency checks: ${consistencyChecks}`);
  console.log('='.repeat(80) + '\n');
  
  // Check for EIA API key
  if (!process.env.EIA_API_KEY) {
    console.error('❌ ERROR: EIA_API_KEY not found in .env.local');
    console.error('Please set your EIA API key before running this script.');
    process.exit(1);
  }
  
  try {
    // Step 1: Direct EIA comparison
    console.log('\n📊 STEP 1: Direct EIA vs App API Comparison');
    console.log('-'.repeat(80));
    
    const directData = await fetchDirectEIA(location, date);
    const appData = await fetchAppAPI(location, date);
    
    const comparison = compareData(directData, appData.hourly, verbose);
    
    console.log('\n📋 Comparison Results:');
    console.log(`  Records: Direct=${comparison.recordCount.direct}, App=${comparison.recordCount.app}`);
    console.log(`  Match: ${comparison.match ? '✅ YES' : '❌ NO'}`);
    
    if (comparison.missingInApp.length > 0) {
      console.log(`  ⚠️  Missing in App: ${comparison.missingInApp.join(', ')}`);
    }
    
    if (comparison.missingInDirect.length > 0) {
      console.log(`  ⚠️  Missing in Direct: ${comparison.missingInDirect.join(', ')}`);
    }
    
    if (comparison.mismatches.length > 0) {
      console.log(`  ❌ Value mismatches: ${comparison.mismatches.length}`);
      if (verbose) {
        console.log('\n  Detailed mismatches:');
        for (const m of comparison.mismatches.slice(0, 10)) {
          console.log(`    ${m.hour} ${m.fuel}: Direct=${m.direct.toFixed(3)}, App=${m.app.toFixed(3)}, Diff=${m.diff.toFixed(3)}`);
        }
        if (comparison.mismatches.length > 10) {
          console.log(`    ... and ${comparison.mismatches.length - 10} more`);
        }
      }
    } else {
      console.log(`  ✅ All values match (within 0.001 GW tolerance)`);
    }
    
    // Mock data detection
    if (comparison.isMockData) {
      console.log('\n  🚨 MOCK DATA DETECTED:');
      for (const pattern of comparison.mockPatterns) {
        console.log(`    - ${pattern}`);
      }
    } else {
      console.log(`  ✅ No mock data patterns detected`);
    }
    
    // Step 2: Consistency check
    console.log('\n\n🔁 STEP 2: Consistency Check (Multiple Requests)');
    console.log('-'.repeat(80));
    
    const fingerprints: string[] = [];
    
    for (let i = 1; i <= consistencyChecks; i++) {
      process.stdout.write(`  Request ${i}/${consistencyChecks}... `);
      const data = await fetchAppAPI(location, date);
      const fingerprint = calculateFingerprint(data.hourly);
      fingerprints.push(fingerprint);
      console.log(`${fingerprint}`);
      
      // Small delay between requests
      if (i < consistencyChecks) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    const allMatch = fingerprints.every(f => f === fingerprints[0]);
    
    console.log('\n📋 Consistency Results:');
    if (allMatch) {
      console.log(`  ✅ All ${consistencyChecks} requests returned identical data`);
      console.log(`  Fingerprint: ${fingerprints[0]}`);
    } else {
      console.log(`  ❌ Inconsistent results detected!`);
      console.log(`  Unique fingerprints:`);
      const unique = Array.from(new Set(fingerprints));
      for (const fp of unique) {
        const count = fingerprints.filter(f => f === fp).length;
        console.log(`    - ${fp} (${count}x)`);
      }
    }
    
    // Final summary
    console.log('\n\n' + '='.repeat(80));
    console.log('VERIFICATION SUMMARY');
    console.log('='.repeat(80));
    
    const directMatch = comparison.match ? '✅' : '❌';
    const consistencyMatch = allMatch ? '✅' : '❌';
    const mockStatus = comparison.isMockData ? '🚨' : '✅';
    
    console.log(`  ${directMatch} Direct EIA vs App API: ${comparison.match ? 'MATCH' : 'MISMATCH'}`);
    console.log(`  ${consistencyMatch} Consistency (${consistencyChecks} requests): ${allMatch ? 'CONSISTENT' : 'INCONSISTENT'}`);
    console.log(`  ${mockStatus} Mock Data Detection: ${comparison.isMockData ? 'DETECTED' : 'NOT DETECTED'}`);
    console.log(`  📊 Data Source: ${appData.meta?.dataSource || 'unknown'}`);
    console.log(`  🕐 Response Time: ${appData.meta?.timestamp || 'N/A'}`);
    
    console.log('='.repeat(80) + '\n');
    
    // Exit code
    if (comparison.match && allMatch && !comparison.isMockData) {
      console.log('✅ VERIFICATION PASSED - Data is accurate and consistent\n');
      process.exit(0);
    } else {
      console.log('❌ VERIFICATION FAILED - Issues detected\n');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n❌ ERROR:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
