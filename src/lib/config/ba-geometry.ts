import {
  BAGeometryFeature,
  BAGeometryFeatureCollection,
  BAGeometryMapping,
} from "@/types/energy";
import { getBAConfig } from "@/lib/config/balancing-authorities";
import { attachAreaToFeatures, sortBAFeaturesByArea } from "@/lib/geometryUtils";

export const CONTROL_AREAS_ARCGIS_QUERY_URL =
  "https://services5.arcgis.com/HDRa0B57OVrv2E1q/arcgis/rest/services/Control_Areas/FeatureServer/0/query";

export const BA_GEOMETRY_MAP: Record<string, BAGeometryMapping> = {
  AECI: { baCode: "AECI", controlAreaName: "ASSOCIATED ELECTRIC COOPERATIVE, INC.", isMappable: true },
  AVA: { baCode: "AVA", controlAreaName: "AVISTA CORPORATION", isMappable: true },
  AVRN: { baCode: "AVRN", controlAreaName: null, isMappable: false, reason: "No control area polygon in canonical source" },
  AZPS: { baCode: "AZPS", controlAreaName: "ARIZONA PUBLIC SERVICE COMPANY", isMappable: true },
  BANC: { baCode: "BANC", controlAreaName: "BALANCING AUTHORITY OF NORTHERN CALIFORNIA", isMappable: true },
  BPAT: { baCode: "BPAT", controlAreaName: "BONNEVILLE POWER ADMINISTRATION", isMappable: true },
  CAL: { baCode: "CAL", controlAreaName: null, isMappable: false, reason: "Regional aggregate, not a single BA polygon" },
  CAR: { baCode: "CAR", controlAreaName: null, isMappable: false, reason: "Regional aggregate, not a single BA polygon" },
  CENT: { baCode: "CENT", controlAreaName: null, isMappable: false, reason: "Regional aggregate, not a single BA polygon" },
  CHPD: { baCode: "CHPD", controlAreaName: "PUBLIC UTILITY DISTRICT NO. 1 OF CHELAN COUNTY", isMappable: true },
  CAISO: { baCode: "CAISO", controlAreaName: "CALIFORNIA INDEPENDENT SYSTEM OPERATOR", isMappable: true },
  CPLE: { baCode: "CPLE", controlAreaName: "DUKE ENERGY PROGRESS EAST", isMappable: true },
  CPLW: { baCode: "CPLW", controlAreaName: "DUKE ENERGY PROGRESS WEST", isMappable: true },
  DEAA: { baCode: "DEAA", controlAreaName: "ARLINGTON VALLEY, LLC - AVBA", isMappable: true },
  DOPD: { baCode: "DOPD", controlAreaName: "PUD NO. 1 OF DOUGLAS COUNTY", isMappable: true },
  DUK: { baCode: "DUK", controlAreaName: "DUKE ENERGY CAROLINAS", isMappable: true },
  EPE: { baCode: "EPE", controlAreaName: "EL PASO ELECTRIC COMPANY", isMappable: true },
  ERCOT: { baCode: "ERCOT", controlAreaName: "ELECTRIC RELIABILITY COUNCIL OF TEXAS, INC.", isMappable: true },
  FLA: { baCode: "FLA", controlAreaName: null, isMappable: false, reason: "Regional aggregate, not a single BA polygon" },
  FMPP: { baCode: "FMPP", controlAreaName: "FLORIDA MUNICIPAL POWER POOL", isMappable: true },
  FPC: { baCode: "FPC", controlAreaName: "DUKE ENERGY FLORIDA INC", isMappable: true },
  FPL: { baCode: "FPL", controlAreaName: "FLORIDA POWER & LIGHT COMPANY", isMappable: true },
  GCPD: { baCode: "GCPD", controlAreaName: "PUBLIC UTILITY DISTRICT NO. 2 OF GRANT COUNTY, WASHINGTON", isMappable: true },
  GRID: { baCode: "GRID", controlAreaName: "GRIDFORCE ENERGY MANAGEMENT, LLC", isMappable: true },
  GVL: { baCode: "GVL", controlAreaName: "GAINESVILLE REGIONAL UTILITIES", isMappable: true },
  GWA: { baCode: "GWA", controlAreaName: "NATURENER POWER WATCH, LLC (GWA)", isMappable: true },
  HGMA: { baCode: "HGMA", controlAreaName: "NEW HARQUAHALA GENERATING COMPANY, LLC - HGBA", isMappable: true },
  HST: { baCode: "HST", controlAreaName: "CITY OF HOMESTEAD", isMappable: true },
  IID: { baCode: "IID", controlAreaName: "IMPERIAL IRRIGATION DISTRICT", isMappable: true },
  IPCO: { baCode: "IPCO", controlAreaName: "IDAHO POWER COMPANY", isMappable: true },
  ISONE: { baCode: "ISONE", controlAreaName: "ISO NEW ENGLAND INC.", isMappable: true },
  JEA: { baCode: "JEA", controlAreaName: "JEA", isMappable: true },
  LDWP: { baCode: "LDWP", controlAreaName: "LOS ANGELES DEPARTMENT OF WATER AND POWER", isMappable: true },
  LGEE: { baCode: "LGEE", controlAreaName: "LOUISVILLE GAS AND ELECTRIC COMPANY AND KENTUCKY UTILITIES", isMappable: true },
  MIDA: { baCode: "MIDA", controlAreaName: null, isMappable: false, reason: "Regional aggregate, not a single BA polygon" },
  MIDW: { baCode: "MIDW", controlAreaName: null, isMappable: false, reason: "Regional aggregate, not a single BA polygon" },
  MISO: { baCode: "MISO", controlAreaName: "MIDCONTINENT INDEPENDENT TRANSMISSION SYSTEM OPERATOR, INC..", isMappable: true },
  NE: { baCode: "NE", controlAreaName: null, isMappable: false, reason: "Regional aggregate, not a single BA polygon" },
  NEVP: { baCode: "NEVP", controlAreaName: "NEVADA POWER COMPANY", isMappable: true },
  NW: { baCode: "NW", controlAreaName: null, isMappable: false, reason: "Regional aggregate, not a single BA polygon" },
  NWMT: { baCode: "NWMT", controlAreaName: "NORTHWESTERN ENERGY (NWMT)", isMappable: true },
  NY: { baCode: "NY", controlAreaName: null, isMappable: false, reason: "Regional aggregate, not a single BA polygon" },
  NYISO: { baCode: "NYISO", controlAreaName: "NEW YORK INDEPENDENT SYSTEM OPERATOR", isMappable: true },
  PACE: { baCode: "PACE", controlAreaName: "PACIFICORP - EAST", isMappable: true },
  PACW: { baCode: "PACW", controlAreaName: "PACIFICORP - WEST", isMappable: true },
  PGE: { baCode: "PGE", controlAreaName: "PORTLAND GENERAL ELECTRIC COMPANY", isMappable: true },
  PJM: { baCode: "PJM", controlAreaName: "PJM INTERCONNECTION, LLC", isMappable: true },
  PNM: { baCode: "PNM", controlAreaName: "PUBLIC SERVICE COMPANY OF NEW MEXICO", isMappable: true },
  PSCO: { baCode: "PSCO", controlAreaName: "PUBLIC SERVICE COMPANY OF COLORADO", isMappable: true },
  PSEI: { baCode: "PSEI", controlAreaName: "PUGET SOUND ENERGY", isMappable: true },
  SC: { baCode: "SC", controlAreaName: null, isMappable: false, reason: "Regional aggregate, not a single BA polygon" },
  SCEG: { baCode: "SCEG", controlAreaName: "SOUTH CAROLINA ELECTRIC & GAS COMPANY", isMappable: true },
  SCL: { baCode: "SCL", controlAreaName: "SEATTLE CITY LIGHT", isMappable: true },
  SE: { baCode: "SE", controlAreaName: null, isMappable: false, reason: "Regional aggregate, not a single BA polygon" },
  SEC: { baCode: "SEC", controlAreaName: "SEMINOLE ELECTRIC COOPERATIVE", isMappable: true },
  SEPA: { baCode: "SEPA", controlAreaName: "SOUTHEASTERN POWER ADMINISTRATION", isMappable: true },
  SOCO: { baCode: "SOCO", controlAreaName: "SOUTHERN COMPANY SERVICES, INC. - TRANS", isMappable: true },
  SPA: { baCode: "SPA", controlAreaName: "SOUTHWESTERN POWER ADMINISTRATION", isMappable: true },
  SRP: { baCode: "SRP", controlAreaName: "SALT RIVER PROJECT", isMappable: true },
  SW: { baCode: "SW", controlAreaName: null, isMappable: false, reason: "Regional aggregate, not a single BA polygon" },
  SPP: { baCode: "SPP", controlAreaName: "SOUTHWEST POWER POOL", isMappable: true },
  TAL: { baCode: "TAL", controlAreaName: "CITY OF TALLAHASSEE", isMappable: true },
  TEC: { baCode: "TEC", controlAreaName: "TAMPA ELECTRIC COMPANY", isMappable: true },
  TEN: { baCode: "TEN", controlAreaName: null, isMappable: false, reason: "Regional aggregate, not a single BA polygon" },
  TEPC: { baCode: "TEPC", controlAreaName: "TUCSON ELECTRIC POWER COMPANY", isMappable: true },
  TEX: { baCode: "TEX", controlAreaName: null, isMappable: false, reason: "Regional aggregate, not a single BA polygon" },
  TIDC: { baCode: "TIDC", controlAreaName: "TURLOCK IRRIGATION DISTRICT", isMappable: true },
  TPWR: { baCode: "TPWR", controlAreaName: "CITY OF TACOMA, DEPARTMENT OF PUBLIC UTILITIES, LIGHT DIVISION", isMappable: true },
  TVA: { baCode: "TVA", controlAreaName: "TENNESSEE VALLEY AUTHORITY", isMappable: true },
  US48: { baCode: "US48", controlAreaName: null, isMappable: false, reason: "National aggregate, not a single BA polygon" },
  WACM: { baCode: "WACM", controlAreaName: "WESTERN AREA POWER ADMINISTRATION - ROCKY MOUNTAIN REGION", isMappable: true },
  WALC: { baCode: "WALC", controlAreaName: "WESTERN AREA POWER ADMINISTRATION - DESERT SOUTHWEST REGION", isMappable: true },
  WAUW: { baCode: "WAUW", controlAreaName: "WESTERN AREA POWER ADMINISTRATION UGP WEST", isMappable: true },
  WWA: { baCode: "WWA", controlAreaName: "NATURENER WIND WATCH, LLC", isMappable: true },
  YAD: { baCode: "YAD", controlAreaName: "ALCOA POWER GENERATING, INC. - YADKIN DIVISION", isMappable: true },
};

export function getBAGeometryMapping(baCode: string): BAGeometryMapping | undefined {
  const ba = getBAConfig(baCode);
  if (!ba) return undefined;
  return BA_GEOMETRY_MAP[ba.code];
}

export function getMappableBAGeometryMappings(): BAGeometryMapping[] {
  return Object.values(BA_GEOMETRY_MAP).filter((mapping) => mapping.isMappable);
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

export async function fetchBAGeometryFeature(baCode: string): Promise<BAGeometryFeature | null> {
  const mapping = getBAGeometryMapping(baCode);

  if (!mapping || !mapping.isMappable || !mapping.controlAreaName) {
    return null;
  }

  const where = `NAME='${escapeSqlString(mapping.controlAreaName)}'`;
  const query = new URLSearchParams({
    where,
    outFields: "NAME,ID",
    returnGeometry: "true",
    f: "geojson",
  });

  const response = await fetch(`${CONTROL_AREAS_ARCGIS_QUERY_URL}?${query.toString()}`);
  if (!response.ok) {
    throw new Error(`Failed to load BA geometry for ${baCode}`);
  }

  const data = (await response.json()) as BAGeometryFeatureCollection;
  if (!data.features || data.features.length === 0) {
    return null;
  }

  const feature = data.features[0];
  // Attach area for prioritization
  attachAreaToFeatures([feature]);
  return feature;
}

export async function fetchAllBAGeometries(): Promise<Record<string, BAGeometryFeature>> {
  const mappableBAs = getMappableBAGeometryMappings();
  const results: Record<string, BAGeometryFeature> = {};
  
  await Promise.all(
    mappableBAs.map(async (mapping) => {
      try {
        const feature = await fetchBAGeometryFeature(mapping.baCode);
        if (feature) {
          results[mapping.baCode] = feature;
        }
      } catch (error) {
        console.warn(`Failed to load geometry for ${mapping.baCode}:`, error);
      }
    })
  );
  
  // Pre-calculate areas for all fetched geometries
  const features = Object.values(results);
  attachAreaToFeatures(features);
  
  return results;
}

// Re-export sortBAFeaturesByArea for use in components
export { sortBAFeaturesByArea };
