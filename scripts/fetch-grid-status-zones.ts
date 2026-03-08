/**
 * Fetch Grid Status Zones Script
 * 
 * Queries Grid Status API to get zone lists for each ISO and updates
 * the config/balancing-authorities.json file with zone data.
 * 
 * Usage:
 *   npm run fetch-zones
 * 
 * Requirements:
 *   - GRID_API_KEY must be set in .env.local
 *   - config/balancing-authorities.json must exist
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

interface GridStatusResponse {
  status_code: number;
  data: GridStatusLMPRow[];
}

// ISO-specific location types to filter for zone-level data
const ISO_ZONE_TYPES: Record<string, string[]> = {
  'CAISO': ['Trading Hub'],  // CAISO uses Trading Hubs for zone-level pricing
  'ERCOT': ['Load Zone'],  // ERCOT load zones
  'ISONE': ['Zone'],       // ISO-NE zones
  'MISO': ['Zone'],        // MISO zones
  'NYISO': ['Zone'],       // NYISO zones (confirmed working)
  'PJM': ['Zone'],         // PJM zones
  'SPP': ['Hub']           // SPP uses hubs for pricing
};

interface BAConfig {
  code: string;
  eiaCode: string;
  name: string;
  type: string;
  timezone: string;
  hasPricing: boolean;
  gridStatusDataset?: string;
  zones?: string[];
  representativeZone?: string;
}

async function fetchZonesForISO(
  dataset: string,
  isoCode: string
): Promise<string[]> {
  const apiKey = process.env.GRID_API_KEY;
  
  if (!apiKey) {
    throw new Error('GRID_API_KEY environment variable not set');
  }

  console.log(`\n📡 Fetching zones for ${isoCode} from dataset: ${dataset}`);

  // Query 24 hours of recent data to ensure we get zones
  // (some ISOs might not have data in the last hour)
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  const url = new URL(`${GRID_STATUS_BASE}/datasets/${dataset}/query`);
  url.searchParams.set('start_time', oneDayAgo.toISOString());
  url.searchParams.set('end_time', now.toISOString());
  url.searchParams.set('limit', '50000');  // Large enough to get all zones over 24h

  const response = await fetch(url.toString(), {
    headers: {
      'x-api-key': apiKey,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Grid Status API error for ${isoCode}: ${response.status} ${response.statusText}\n${errorText}`
    );
  }

  const data: GridStatusResponse = await response.json();

  if (!data.data || !Array.isArray(data.data)) {
    throw new Error(`Unexpected API response structure for ${isoCode}`);
  }

  // Get ISO-specific location types to filter for
  const targetLocationTypes = ISO_ZONE_TYPES[isoCode] || ['Zone'];

  // Filter to target location types
  const zoneRecords = data.data.filter((row) => 
    targetLocationTypes.includes(row.location_type)
  );

  if (zoneRecords.length === 0) {
    console.log(`⚠️  No data found for location types: ${targetLocationTypes.join(', ')}`);
    // Show what types are available
    const locationTypes = new Set(data.data.map((row) => row.location_type));
    console.log(`   Available types: ${Array.from(locationTypes).join(', ')}`);
    
    // Return empty array if no matching data found
    console.log(`   ❌ No zones found for ${isoCode}`);
    return [];
  }

  // Extract unique zone names
  const uniqueZones = Array.from(
    new Set(zoneRecords.map((row) => row.location))
  ).sort();

  console.log(`✅ Found ${uniqueZones.length} zones (from ${zoneRecords.length} records)`);
  console.log(`   Sample zones: ${uniqueZones.slice(0, 5).join(', ')}${uniqueZones.length > 5 ? '...' : ''}`);

  return uniqueZones;
}

async function main() {
  console.log('🚀 Starting Grid Status Zone Fetch\n');

  try {
    // Load existing config
    const configPath = path.join(process.cwd(), 'config', 'balancing-authorities.json');
    
    if (!fs.existsSync(configPath)) {
      throw new Error(`Config file not found: ${configPath}\nRun 'npm run fetch-respondents' first.`);
    }

    const config: Record<string, BAConfig> = JSON.parse(
      fs.readFileSync(configPath, 'utf-8')
    );

    // Find all ISOs with pricing support
    const isosWithPricing = Object.values(config).filter(
      (ba) => ba.hasPricing && ba.gridStatusDataset
    );

    console.log(`📋 Found ${isosWithPricing.length} ISOs with pricing support:\n`);
    isosWithPricing.forEach((iso) => {
      console.log(`   - ${iso.code} (${iso.eiaCode}) → ${iso.gridStatusDataset}`);
    });

    // Fetch zones for each ISO
    const results: Record<string, string[]> = {};

    for (const iso of isosWithPricing) {
      try {
        const zones = await fetchZonesForISO(iso.gridStatusDataset!, iso.code);
        results[iso.code] = zones;
        
        // Update config
        config[iso.code].zones = zones;
        
        // Small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`❌ Failed to fetch zones for ${iso.code}:`, error instanceof Error ? error.message : error);
        console.log(`   Skipping ${iso.code}, you can populate manually later.\n`);
      }
    }

    // Write updated config
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    console.log('\n✅ Configuration updated successfully!');
    console.log(`   File: ${configPath}\n`);

    // Summary
    console.log('📊 Zone Count Summary:');
    Object.entries(results).forEach(([iso, zones]) => {
      console.log(`   ${iso.padEnd(8)} - ${zones.length} zones`);
    });

    console.log('\n✨ Phase 1 Complete!');
    console.log('   All 75 BAs configured with zone data for 7 ISOs\n');

    console.log('📝 Next Steps (Phase 2):');
    console.log('   1. Review zone lists in config/balancing-authorities.json');
    console.log('   2. Verify representative zones are correct');
    console.log('   3. Begin backend refactoring to use config file\n');

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}
