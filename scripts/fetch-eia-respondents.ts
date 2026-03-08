/**
 * Fetch EIA Respondents Script
 * 
 * Queries EIA API to get all 75 Balancing Authority respondents and generates
 * the config/balancing-authorities.json configuration file.
 * 
 * Usage:
 *   npm run fetch-respondents
 * 
 * Requirements:
 *   - EIA_API_KEY must be set in .env.local
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

const EIA_BASE = "https://api.eia.gov/v2";
const EIA_ENDPOINT = `${EIA_BASE}/electricity/rto/fuel-type-data/data/`;

// Known ISOs with pricing support
const ISOS_WITH_PRICING = {
  NYIS: { common: 'NYISO', timezone: 'America/New_York', dataset: 'nyiso_lmp_real_time_hourly' },
  CISO: { common: 'CAISO', timezone: 'America/Los_Angeles', dataset: 'caiso_lmp_real_time_15_min' },
  PJM: { common: 'PJM', timezone: 'America/New_York', dataset: 'pjm_lmp_real_time_hourly' },
  MISO: { common: 'MISO', timezone: 'America/Chicago', dataset: 'miso_lmp_real_time_hourly_final' },
  ERCO: { common: 'ERCOT', timezone: 'America/Chicago', dataset: 'ercot_lmp_by_settlement_point' },
  ISNE: { common: 'ISONE', timezone: 'America/New_York', dataset: 'isone_lmp_real_time_hourly_final' },
  SWPP: { common: 'SPP', timezone: 'America/Chicago', dataset: 'spp_lmp_real_time_5_min' },
};

// Placeholder zones - will be manually populated after querying Grid Status
const ISO_ZONES: Record<string, string[]> = {
  NYIS: [], // To be filled: ["CAPITL", "CENTRL", "DUNWOD", "GENESE", "HUD_VL", "LONGIL", "MHK_VL", "MILLWD", "N.Y.C.", "NORTH", "WEST"]
  CISO: [], // To be filled: ["NP15", "ZP26", "SP15"]
  PJM: [],  // To be filled: Query Grid Status for zone list
  MISO: [], // To be filled: Query Grid Status for zone list
  ERCO: [], // To be filled: ["HB_HOUSTON", "HB_NORTH", "HB_SOUTH", "HB_WEST", etc.]
  ISNE: [], // To be filled: Query Grid Status for zone list
  SWPP: [], // To be filled: Query Grid Status for zone list
};

const REPRESENTATIVE_ZONES: Record<string, string> = {
  NYIS: "CENTRL",
  CISO: "SP15",
  PJM: "AEP",
  MISO: "MISO.ILLINOIS",
  ERCO: "HB_HOUSTON",
  ISNE: ".H.INTERNAL_HUB",
  SWPP: "SPP.SPPSYSTEM",
};

interface BAConfig {
  code: string;
  eiaCode: string;
  name: string;
  type: 'ISO' | 'Utility' | 'Regional';
  timezone: string;
  hasPricing: boolean;
  gridStatusDataset?: string;
  zones?: string[];
  representativeZone?: string;
}

async function fetchRespondents(): Promise<string[]> {
  const apiKey = process.env.EIA_API_KEY;
  
  if (!apiKey) {
    throw new Error('EIA_API_KEY environment variable not set');
  }

  console.log('📡 Fetching respondent list from EIA API...');
  
  // Query recent data to get all respondents  // We'll fetch enough records to capture all respondents
  const url = new URL(EIA_ENDPOINT);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('frequency', 'hourly');
  url.searchParams.set('data', 'value');
  url.searchParams.set('start', '2024-01-01T00');
  url.searchParams.set('end', '2024-01-01T00');  // Single hour
  url.searchParams.set('sort[0][column]', 'period');
  url.searchParams.set('sort[0][direction]', 'asc');
  url.searchParams.set('offset', '0');
  url.searchParams.set('length', '5000');  // Maximum allowed per request
  
  console.log('🔍 Querying EIA API for all respondents...');
  
  const response = await fetch(url.toString());
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`EIA API error: ${response.status} ${response.statusText}\n${errorText}`);
  }
  
  const data = await response.json();
  
  // Extract unique respondent codes from the data
  const dataRows = data.response?.data;
  if (!dataRows || !Array.isArray(dataRows)) {
    console.log('API Response:', JSON.stringify(data, null, 2).substring(0, 500));
    throw new Error('Unexpected API response structure - no data array');
  }
  
  const uniqueRespondents = new Set<string>();
  dataRows.forEach((row: any) => {
    if (row.respondent) {
      uniqueRespondents.add(row.respondent);
    }
  });
  
  const respondents = Array.from(uniqueRespondents).sort();
  
  console.log(`✅ Found ${respondents.length} unique respondents from ${dataRows.length} data records`);
  
  return respondents;
}

function classifyBA(code: string): 'ISO' | 'Utility' | 'Regional' {
  if (ISOS_WITH_PRICING[code as keyof typeof ISOS_WITH_PRICING]) {
    return 'ISO';
  }
  
  // Regional aggregations (usually 2-3 letter codes or "US48")
  if (code.length <= 3 || code === 'US48' || code.startsWith('US')) {
    return 'Regional';
  }
  
  return 'Utility';
}

function guessTimezone(code: string): string {
  // Default timezone guessing based on common patterns
  // This is approximate - manual verification recommended
  
  const eastern = ['NY', 'NE', 'PJM', 'FPL', 'TVA', 'DUK', 'SOCO'];
  const central = ['MISO', 'SPP', 'ERCO', 'SWPP', 'LGEE', 'WAUE'];
  const mountain = ['PACE', 'AZPS', 'NEVP', 'PSCO', 'TPWR'];
  const pacific = ['CISO', 'LDWP', 'SCL', 'TIDC', 'BPAT', 'PACW'];
  
  if (eastern.some(prefix => code.startsWith(prefix))) {
    return 'America/New_York';
  }
  if (central.some(prefix => code.startsWith(prefix))) {
    return 'America/Chicago';
  }
  if (mountain.some(prefix => code.startsWith(prefix))) {
    return 'America/Denver';
  }
  if (pacific.some(prefix => code.startsWith(prefix))) {
    return 'America/Los_Angeles';
  }
  
  // Default to Eastern (most common)
  return 'America/New_York';
}

function generateConfig(respondents: string[]): Record<string, BAConfig> {
  const config: Record<string, BAConfig> = {};
  
  for (const eiaCode of respondents) {
    const isoInfo = ISOS_WITH_PRICING[eiaCode as keyof typeof ISOS_WITH_PRICING];
    const isISO = !!isoInfo;
    const commonCode = isoInfo?.common || eiaCode;
    
    const ba: BAConfig = {
      code: commonCode,
      eiaCode: eiaCode,
      name: `${eiaCode} ${isISO ? 'Independent System Operator' : ''}`.trim(),
      type: classifyBA(eiaCode),
      timezone: isoInfo?.timezone || guessTimezone(eiaCode),
      hasPricing: isISO,
    };
    
    if (isISO && isoInfo) {
      ba.gridStatusDataset = isoInfo.dataset;
      ba.zones = ISO_ZONES[eiaCode] || [];
      ba.representativeZone = REPRESENTATIVE_ZONES[eiaCode];
    }
    
    config[commonCode] = ba;
  }
  
  return config;
}

async function main() {
  console.log('🚀 Starting EIA Respondent Fetch\n');
  
  try {
    // Fetch respondents from EIA
    const respondents = await fetchRespondents();
    
    console.log('\n📋 Sample respondents:');
    respondents.slice(0, 10).forEach(r => console.log(`  - ${r}`));
    console.log(`  ... and ${respondents.length - 10} more\n`);
    
    // Generate configuration
    console.log('⚙️  Generating configuration...');
    const config = generateConfig(respondents);
    
    // Show ISOs with pricing
    console.log('\n✨ ISOs with pricing support:');
    Object.values(config)
      .filter(ba => ba.hasPricing)
      .forEach(ba => console.log(`  - ${ba.code} (${ba.eiaCode})`));
    
    // Create config directory if it doesn't exist
    const configDir = path.join(process.cwd(), 'config');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
      console.log('\n📁 Created config/ directory');
    }
    
    // Write configuration
    const outputPath = path.join(configDir, 'balancing-authorities.json');
    fs.writeFileSync(outputPath, JSON.stringify(config, null, 2));
    
    console.log(`\n✅ Configuration written to: ${outputPath}`);
    console.log(`\n📝 Total: ${Object.keys(config).length} balancing authorities`);
    console.log(`   - ${Object.values(config).filter(ba => ba.hasPricing).length} ISOs with pricing`);
    console.log(`   - ${Object.values(config).filter(ba => !ba.hasPricing).length} entities without pricing\n`);
    
    console.log('⚠️  NEXT STEPS:');
    console.log('   1. Query Grid Status API to get zone lists for each ISO');
    console.log('   2. Manually populate the "zones" arrays in the config file');
    console.log('   3. Verify timezone assignments for non-ISO entities');
    console.log('   4. Review and update BA names for accuracy\n');
    
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}
