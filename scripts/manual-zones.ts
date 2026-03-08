/**
 * Manual zone definitions for ISOs where automated API fetching is not practical
 * These are curated from official ISO documentation and zone maps
 */

export const MANUAL_ZONES: Record<string, string[]> = {
  // CAISO - California ISO
  // Uses load aggregation points (LAPs) for zone-level pricing
  CAISO: [
    'PGAE_VALLEY',     // PG&E Valley
    'PGAE_BAY',        // PG&E Bay Area  
    'SDGE',            // San Diego Gas & Electric
    'SCE',             // Southern California Edison
  ],

  // ISO-NE (ISONE) - ISO New England
  // Uses load zones across the 6 New England states
 ISONE: [
    'MAINE',
    'NEWHAMPSHIRE',
    'VERMONT',
    'CONNECTICUT',
    'RHODEISLAND',
    'SEMASS',          // Southeastern Massachusetts
    'WCMASS',          // Western/Central Massachusetts
    'NEMA_BOSTON',     // Northeastern MA / Boston
  ],

  // MISO - Midcontinent ISO
  // Large multi-state coverage with numbered local resource zones
  MISO: [
    'MISO.1',   // Michigan
    'MISO.2',   // Indiana
    'MISO.3',   // Illinois
    'MISO.4',   // Missouri/Eastern Missouri
    'MISO.5',   // Wisconsin
    'MISO.6',   // Iowa
    'MISO.7',   // Minnesota
    'MISO.8',   // Northern Indiana
    'MISO.9',   // Southern Indiana
    'MISO.10',  // Western Indiana
  ],

  // PJM - Pennsylvania, Jersey, Maryland Interconnection
  // Uses 21+ load zones across mid-Atlantic and Midwest
  PJM: [
    'AEP',        // American Electric Power
    'APS',        // Appalachian Power
    'ATSI',       // American Transmission Systems Inc
    'BGE',        // Baltimore Gas & Electric
    'COMED',      // Commonwealth Edison
    'DAY',        // Dayton Power & Light
    'DEOK',       // Duke Energy Ohio/Kentucky
    'DOM',        // Dominion
    'DPL',        // Delmarva Power & Light
    'DUQ',        // Duquesne Light
    'EKPC',       // East Kentucky Power Cooperative
    'JCPL',       // Jersey Central Power & Light
    'METED',      // Met-Ed
    'PECO',       // PECO Energy
    'PENELEC',    // Pennsylvania Electric
    'PEPCO',      // Potomac Electric Power
    'PPL',        // PPL Electric Utilities
    'PSEG',       // Public Service Electric & Gas
    'RECO',       // Rockland Electric
  ],

  // SPP - Southwest Power Pool  
  // Uses market hubs for pricing
  SPP: [
    'SPS_NORTH_HUB',
    'OKGE_HUB',
    'WR_HUB',
    'KCPL_HUB',
  ],
};
