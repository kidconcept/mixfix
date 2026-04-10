/**
 * Test script to measure pricing data fetch times across different US nodes
 * Run with: npx tsx test-pricing-fetch.ts
 */

interface FetchResult {
  iso: string;
  node: string;
  date: string;
  startTime: number;
  endTime: number;
  duration: number;
  success: boolean;
  dataPoints: number;
  error?: string;
}

// All configured zones from config/balancing-authorities.json + mismatched representative zones
const TEST_NODES = [
  // NYISO — 11 zones
  { iso: "NYISO", node: "CAPITL", name: "Capital Region" },
  { iso: "NYISO", node: "CENTRL", name: "Central" },
  { iso: "NYISO", node: "DUNWOD", name: "Dunwoodie" },
  { iso: "NYISO", node: "GENESE", name: "Genesee" },
  { iso: "NYISO", node: "HUD VL", name: "Hudson Valley" },
  { iso: "NYISO", node: "LONGIL", name: "Long Island" },
  { iso: "NYISO", node: "MHK VL", name: "Mohawk Valley" },
  { iso: "NYISO", node: "MILLWD", name: "Millwood" },
  { iso: "NYISO", node: "N.Y.C.", name: "New York City" },
  { iso: "NYISO", node: "NORTH", name: "North" },
  { iso: "NYISO", node: "WEST", name: "West" },

  // CAISO — 3 zones
  { iso: "CAISO", node: "TH_SP15_GEN-APND", name: "SP15 Hub" },
  { iso: "CAISO", node: "TH_NP15_GEN-APND", name: "NP15 Hub" },
  { iso: "CAISO", node: "TH_ZP26_GEN-APND", name: "ZP26 Hub" },

  // ERCOT — 8 zones + 1 mismatched representative
  { iso: "ERCOT", node: "LZ_HOUSTON", name: "Houston Load Zone" },
  { iso: "ERCOT", node: "LZ_NORTH", name: "North Load Zone" },
  { iso: "ERCOT", node: "LZ_SOUTH", name: "South Load Zone" },
  { iso: "ERCOT", node: "LZ_WEST", name: "West Load Zone" },
  { iso: "ERCOT", node: "LZ_AEN", name: "AEN Load Zone" },
  { iso: "ERCOT", node: "LZ_CPS", name: "CPS Energy Load Zone" },
  { iso: "ERCOT", node: "LZ_LCRA", name: "LCRA Load Zone" },
  { iso: "ERCOT", node: "LZ_RAYBN", name: "Rayburn Load Zone" },
  { iso: "ERCOT", node: "HB_HOUSTON", name: "⚠️ Houston Hub (rep)" },

  // ISONE — 8 zones
  { iso: "ISONE", node: ".Z.MAINE", name: "Maine" },
  { iso: "ISONE", node: ".Z.NEWHAMPSHIRE", name: "New Hampshire" },
  { iso: "ISONE", node: ".Z.VERMONT", name: "Vermont" },
  { iso: "ISONE", node: ".Z.CONNECTICUT", name: "Connecticut" },
  { iso: "ISONE", node: ".Z.RHODEISLAND", name: "Rhode Island" },
  { iso: "ISONE", node: ".Z.SEMASS", name: "SE Massachusetts" },
  { iso: "ISONE", node: ".Z.WCMASS", name: "W/C Massachusetts" },
  { iso: "ISONE", node: ".Z.NEMASSBOST", name: "NE Mass/Boston" },

  // MISO — 8 zones
  { iso: "MISO", node: "ILLINOIS.HUB", name: "Illinois Hub" },
  { iso: "MISO", node: "INDIANA.HUB", name: "Indiana Hub" },
  { iso: "MISO", node: "MICHIGAN.HUB", name: "Michigan Hub" },
  { iso: "MISO", node: "MINN.HUB", name: "Minnesota Hub" },
  { iso: "MISO", node: "ARKANSAS.HUB", name: "Arkansas Hub" },
  { iso: "MISO", node: "LOUISIANA.HUB", name: "Louisiana Hub" },
  { iso: "MISO", node: "TEXAS.HUB", name: "Texas Hub" },
  { iso: "MISO", node: "MS.HUB", name: "Mississippi Hub" },

  // PJM — 15 zones
  { iso: "PJM", node: "AEP", name: "American Electric Power" },
  { iso: "PJM", node: "APS", name: "Appalachian Power" },
  { iso: "PJM", node: "ATSI", name: "American Trans Systems" },
  { iso: "PJM", node: "BGE", name: "Baltimore Gas & Electric" },
  { iso: "PJM", node: "COMED", name: "Commonwealth Edison" },
  { iso: "PJM", node: "DAY", name: "Dayton Power & Light" },
  { iso: "PJM", node: "DEOK", name: "Duke Energy OH/KY" },
  { iso: "PJM", node: "DOM", name: "Dominion" },
  { iso: "PJM", node: "DPL", name: "Delmarva Power & Light" },
  { iso: "PJM", node: "DUQ", name: "Duquesne Light" },
  { iso: "PJM", node: "JCPL", name: "Jersey Central P&L" },
  { iso: "PJM", node: "PECO", name: "PECO Energy" },
  { iso: "PJM", node: "PEPCO", name: "Potomac Electric Power" },
  { iso: "PJM", node: "PPL", name: "PPL Electric Utilities" },
  { iso: "PJM", node: "PSEG", name: "Public Service E&G" },

  // SPP — 2 zones
  { iso: "SPP", node: "SPPNORTH_HUB", name: "SPP North Hub" },
  { iso: "SPP", node: "SPPSOUTH_HUB", name: "SPP South Hub" },
];

async function testPricingFetch(
  iso: string,
  node: string,
  date: string
): Promise<FetchResult> {
  const startTime = Date.now();
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const url = `${baseUrl}/api/energy?date=${date}&location=${iso}&view=pricing&node=${encodeURIComponent(node)}`;

  try {
    console.log(`Fetching: ${iso} - ${node}...`);
    
    const response = await fetch(url, {
      signal: AbortSignal.timeout(90000), // 90 second timeout
    });

    const endTime = Date.now();
    const duration = endTime - startTime;

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
      const errorDetails = errorData.details ? ` - ${errorData.details}` : '';
      return {
        iso,
        node,
        date,
        startTime,
        endTime,
        duration,
        success: false,
        dataPoints: 0,
        error: `${errorData.error || `HTTP ${response.status}`}${errorDetails}`,
      };
    }

    const data = await response.json();
    const dataPoints = data.lmp?.length || 0;

    return {
      iso,
      node,
      date,
      startTime,
      endTime,
      duration,
      success: true,
      dataPoints,
    };
  } catch (error) {
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    return {
      iso,
      node,
      date,
      startTime,
      endTime,
      duration,
      success: false,
      dataPoints: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

async function runTests() {
  console.log("\n========================================");
  console.log("PRICING DATA FETCH TIME ANALYSIS");
  console.log("========================================\n");

  // Test with a date 3 days ago (definitely has data)
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  const testDate = threeDaysAgo.toISOString().split("T")[0];

  console.log(`Test Date: ${testDate}`);
  console.log(`Total Nodes: ${TEST_NODES.length}\n`);

  const results: FetchResult[] = [];

  // Run tests sequentially to avoid overwhelming the API
  for (const testNode of TEST_NODES) {
    const result = await testPricingFetch(testNode.iso, testNode.node, testDate);
    results.push(result);
    
    const status = result.success ? "✅" : "❌";
    const duration = formatDuration(result.duration);
    const dataInfo = result.success ? `${result.dataPoints} points` : result.error;
    
    console.log(`${status} ${testNode.iso.padEnd(8)} ${testNode.name.padEnd(25)} ${duration.padStart(8)} - ${dataInfo}`);
    
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Calculate statistics
  console.log("\n========================================");
  console.log("SUMMARY STATISTICS");
  console.log("========================================\n");

  const successfulResults = results.filter(r => r.success);
  const failedResults = results.filter(r => !r.success);

  console.log(`Total Tests: ${results.length}`);
  console.log(`Successful: ${successfulResults.length} (${((successfulResults.length / results.length) * 100).toFixed(1)}%)`);
  console.log(`Failed: ${failedResults.length} (${((failedResults.length / results.length) * 100).toFixed(1)}%)\n`);

  if (successfulResults.length > 0) {
    const durations = successfulResults.map(r => r.duration);
    const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
    const minDuration = Math.min(...durations);
    const maxDuration = Math.max(...durations);
    const medianDuration = durations.sort((a, b) => a - b)[Math.floor(durations.length / 2)];

    console.log("Duration Statistics:");
    console.log(`  Average: ${formatDuration(avgDuration)}`);
    console.log(`  Median:  ${formatDuration(medianDuration)}`);
    console.log(`  Min:     ${formatDuration(minDuration)}`);
    console.log(`  Max:     ${formatDuration(maxDuration)}`);
    console.log();

    // Group by ISO
    const byISO = new Map<string, FetchResult[]>();
    successfulResults.forEach(r => {
      if (!byISO.has(r.iso)) byISO.set(r.iso, []);
      byISO.get(r.iso)!.push(r);
    });

    console.log("Average Duration by ISO:");
    for (const [iso, isoResults] of byISO) {
      const isoAvg = isoResults.reduce((sum, r) => sum + r.duration, 0) / isoResults.length;
      console.log(`  ${iso.padEnd(8)}: ${formatDuration(isoAvg)}`);
    }
    console.log();
  }

  if (failedResults.length > 0) {
    console.log("Failed Requests:");
    failedResults.forEach(r => {
      console.log(`  ${r.iso} - ${r.node}: ${r.error}`);
    });
    console.log();
  }

  // Performance categories
  const fast = successfulResults.filter(r => r.duration < 5000).length;
  const medium = successfulResults.filter(r => r.duration >= 5000 && r.duration < 15000).length;
  const slow = successfulResults.filter(r => r.duration >= 15000).length;

  console.log("Performance Distribution:");
  console.log(`  Fast (<5s):      ${fast} (${((fast / results.length) * 100).toFixed(1)}%)`);
  console.log(`  Medium (5-15s):  ${medium} (${((medium / results.length) * 100).toFixed(1)}%)`);
  console.log(`  Slow (>15s):     ${slow} (${((slow / results.length) * 100).toFixed(1)}%)`);
  console.log();

  console.log("========================================\n");
}

// Run the tests
runTests().catch(console.error);
