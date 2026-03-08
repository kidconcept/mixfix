import * as fs from 'fs';
import * as path from 'path';

// Zones successfully fetched from Grid Status API
const FETCHED_ZONES = {
  ERCOT: [
    'LZ_AEN',
    'LZ_CPS',
    'LZ_HOUSTON',
    'LZ_LCRA',
    'LZ_NORTH',
    'LZ_RAYBN',
    'LZ_SOUTH',
    'LZ_WEST',
  ],
  
  NYISO: [
    'CAPITL',
    'CENTRL',
    'DUNWOD',
    'GENESE',
    'H Q',
    'HUD VL',
    'LONGIL',
    'MHK VL',
    'MILLWD',
    'N.Y.C.',
    'NORTH',
    'NPX',
    'O H',
    'PJM',
    'WEST',
  ],
};

// Manually curated zones for ISOs where API access is limited
const MANUAL_ZONES = {
  CAISO: [
    'TH_SP15_GEN-APND',  // SP15 Trading Hub
    'TH_NP15_GEN-APND',  // NP15 Trading Hub  
    'TH_ZP26_GEN-APND',  // ZP26 Trading Hub
  ],

  ISONE: [
    '.Z.MAINE',
    '.Z.NEWHAMPSHIRE',
    '.Z.VERMONT',
    '.Z.CONNECTICUT',
    '.Z.RHODEISLAND',
    '.Z.SEMASS',
    '.Z.WCMASS',
    '.Z.NEMASSBOST',
  ],

  MISO: [
    'MISO.ILLINOIS.HUB',
    'MISO.INDIANA.HUB',
    'MISO.MICHIGAN.HUB',
    'MISO.MINNESOTA.HUB',
    'MISO.ARKANSAS.HUB',
    'MISO.LOUISIANA.HUB',
    'MISO.TEXAS.HUB',
  ],

  PJM: [
    'AEP',
    'APS',
    'ATSI',
    'BGE',
    'COMED',
    'DAY',
    'DEOK',
    'DOM',
    'DPL',
    'DUQ',
    'EKPC',
    'JCPL',
    'METED',
    'PECO',
    'PENELEC',
    'PEPCO',
    'PPL',
    'PSEG',
    'RECO',
  ],

  SPP: [
    'SWPP_OKGE_HUB',
    'SWPP_SPS_NRTH_HUB',
    'SWPP_WR_HUB',
  ],
};

// Combine all zones
const ALL_ZONES = {
  ...FETCHED_ZONES,
  ...MANUAL_ZONES,
};

async function main() {
  console.log('🚀 Populating Zone Data\n');

  // Load config
  const configPath = path.join(process.cwd(), 'config', 'balancing-authorities.json');
  const configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  // Update each ISO's zones
  let updatedCount = 0;
  for (const [isoCode, zones] of Object.entries(ALL_ZONES)) {
    if (configData[isoCode]) {
      configData[isoCode].zones = zones;
      console.log(`✅ ${isoCode}: ${zones.length} zones`);
      updatedCount++;
    } else {
      console.log(`⚠️  ${isoCode} not found in config`);
    }
  }

  // Write updated config
  fs.writeFileSync(configPath, JSON.stringify(configData, null, 2) + '\n');

  console.log(`\n✨ Updated ${updatedCount} ISOs with zone data`);
  console.log(`📁 Config written to: ${configPath}`);
  
  console.log('\n📊 Summary:');
  console.log(`  CAISO: ${ALL_ZONES.CAISO.length} trading hubs`);
  console.log(`  ERCOT: ${ALL_ZONES.ERCOT.length} load zones`);
  console.log(`  ISONE: ${ALL_ZONES.ISONE.length} zones`);
  console.log(`  MISO: ${ALL_ZONES.MISO.length} hubs`);
  console.log(`  NYISO: ${ALL_ZONES.NYISO.length} zones`);
  console.log(`  PJM: ${ALL_ZONES.PJM.length} zones`);
  console.log(`  SPP: ${ALL_ZONES.SPP.length} hubs`);
}

main().catch((error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
