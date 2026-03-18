import { NextResponse } from "next/server";
import { getRepresentativeZone, hasPricingData } from "@/lib/config/balancing-authorities";
import {
  BA_GEOMETRY_MAP,
  CONTROL_AREAS_ARCGIS_QUERY_URL,
  fetchBAGeometryFeature,
} from "@/lib/config/ba-geometry";
import zoneBoundaries from "../../../../config/zone-boundaries.json";

interface ZoneBoundary {
  zone: string;
  name: string;
  bounds: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  };
}

interface ISOZoneBoundaries {
  zones: ZoneBoundary[];
}

// Type assertion for imported JSON
const boundaries: Record<string, ISOZoneBoundaries> = zoneBoundaries as Record<string, ISOZoneBoundaries>;

const CONTROL_AREA_NAME_TO_BA: Record<string, string> = Object.values(BA_GEOMETRY_MAP).reduce(
  (acc, mapping) => {
    if (mapping.isMappable && mapping.controlAreaName) {
      acc[mapping.controlAreaName] = mapping.baCode;
    }
    return acc;
  },
  {} as Record<string, string>
);

const LOW_PRIORITY_OVERLAY_BAS = new Set(["WACM", "WALC", "WAUW", "SEPA", "SPA"]);

/**
 * Find the zone within an ISO that contains the given coordinates
 */
function findZoneByCoordinates(iso: string, lat: number, lon: number): string | null {
  const isoBoundaries = boundaries[iso];
  if (!isoBoundaries) return null;

  // Find the first zone that contains these coordinates
  for (const zoneBoundary of isoBoundaries.zones) {
    const { minLat, maxLat, minLon, maxLon } = zoneBoundary.bounds;
    if (lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon) {
      return zoneBoundary.zone;
    }
  }

  return null;
}

/**
 * Map coordinates to ISO/RTO regions and specific zones based on geographic boundaries
 * Returns ISO code and specific zone code for pricing data
 */
function getISOFromCoordinates(lat: number, lon: number): {
  iso: string;
  zone: string;
} | null {
  let detectedISO: string | null = null;

  // NYISO - New York State
  if (lat >= 40.5 && lat <= 45.0 && lon >= -79.8 && lon <= -71.8) {
    detectedISO = "NYISO";
  }
  // ISONE - New England (CT, MA, ME, NH, RI, VT)
  else if (lat >= 41.0 && lat <= 47.5 && lon >= -73.5 && lon <= -66.9) {
    detectedISO = "ISONE";
  }
  // PJM - Mid-Atlantic/Midwest (PA, NJ, MD, DE, VA, WV, OH, IL, parts of others)
  else if (
    (lat >= 37.5 && lat <= 42.5 && lon >= -83.0 && lon <= -74.0) ||
    (lat >= 38.0 && lat <= 40.5 && lon >= -91.5 && lon <= -87.5)
  ) {
    detectedISO = "PJM";
  }
  // MISO - Midwest (15 states from Manitoba to Louisiana)
  else if (
    (lat >= 38.0 && lat <= 49.0 && lon >= -104.0 && lon <= -84.0) ||
    (lat >= 29.0 && lat <= 33.0 && lon >= -93.0 && lon <= -88.5)
  ) {
    // Exclude NYISO region
    if (!(lat >= 40.5 && lat <= 45.0 && lon >= -79.8 && lon <= -71.8)) {
      detectedISO = "MISO";
    }
  }
  // SPP - Great Plains (Kansas, Oklahoma, parts of surrounding states)
  else if (lat >= 33.5 && lat <= 43.0 && lon >= -106.0 && lon <= -90.0) {
    detectedISO = "SPP";
  }
  // ERCOT - Texas (most of the state)
  else if (lat >= 25.8 && lat <= 36.5 && lon >= -106.6 && lon <= -93.5) {
    detectedISO = "ERCOT";
  }
  // CAISO - California
  else if (lat >= 32.5 && lat <= 42.0 && lon >= -124.5 && lon <= -114.1) {
    detectedISO = "CAISO";
  }
  // FPL - Florida (most of the state)
  else if (lat >= 24.5 && lat <= 31.0 && lon >= -87.6 && lon <= -80.0) {
    detectedISO = "FPL";
  }
  // SOCO - Southern Company (GA, AL, MS)
  else if (lat >= 30.2 && lat <= 35.0 && lon >= -91.7 && lon <= -81.0) {
    detectedISO = "SOCO";
  }
  // DUK - Duke Energy Carolinas (NC, SC)
  else if (lat >= 33.8 && lat <= 36.6 && lon >= -82.7 && lon <= -78.5) {
    detectedISO = "DUK";
  }
  // TVA - Tennessee Valley Authority (TN, AL, MS, KY, GA, NC, VA)
  else if (lat >= 33.0 && lat <= 37.5 && lon >= -90.3 && lon <= -81.6) {
    detectedISO = "TVA";
  }
  // BPAT - Bonneville Power Administration (OR, WA, ID)
  else if (lat >= 42.0 && lat <= 49.0 && lon >= -124.6 && lon <= -116.0) {
    detectedISO = "BPAT";
  }
  // PACE - PacifiCorp East (Rocky Mountain states)
  else if (lat >= 37.0 && lat <= 49.0 && lon >= -114.0 && lon <= -104.0) {
    detectedISO = "PACE";
  }
  // PACW - PacifiCorp West (Pacific Northwest)
  else if (lat >= 42.0 && lat <= 49.0 && lon >= -124.5 && lon <= -116.9) {
    detectedISO = "PACW";
  }

  if (!detectedISO) {
    return null;
  }

  // Try to find specific zone within the detected ISO using zone boundaries
  const specificZone = findZoneByCoordinates(detectedISO, lat, lon);
  
  // If no specific zone found, use representative zone as fallback
  const zone = specificZone || getRepresentativeZone(detectedISO) || "";

  return {
    iso: detectedISO,
    zone,
  };
}

interface ArcGISPointQueryResponse {
  features?: Array<{
    attributes?: {
      NAME?: string;
      ID?: string;
      [key: string]: string | number | null | undefined;
    };
  }>;
}

async function getBAFromGeometryIntersection(lat: number, lon: number): Promise<string | null> {
  const geometry = JSON.stringify({
    x: lon,
    y: lat,
    spatialReference: { wkid: 4326 },
  });

  const params = new URLSearchParams({
    where: "1=1",
    geometry,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "NAME,ID",
    returnGeometry: "false",
    f: "json",
  });

  const response = await fetch(`${CONTROL_AREAS_ARCGIS_QUERY_URL}?${params.toString()}`, {
    headers: {
      "User-Agent": "MixFix-Energy-App",
    },
  });

  if (!response.ok) {
    throw new Error(`Control-area query failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as ArcGISPointQueryResponse;
  const candidateBAs = (data.features || [])
    .map((feature) => feature.attributes?.NAME)
    .filter((name): name is string => !!name)
    .map((name) => CONTROL_AREA_NAME_TO_BA[name])
    .filter((baCode): baCode is string => !!baCode);

  if (candidateBAs.length === 0) return null;
  if (candidateBAs.length === 1) return candidateBAs[0];

  // Multiple BAs intersect this point - prioritize by area (smallest first)
  console.log(`Multiple BAs intersect (${lat}, ${lon}):`, candidateBAs);

  // Fetch full geometry features to access pre-calculated areas
  const featuresWithAreas = await Promise.all(
    candidateBAs.map(async (baCode) => {
      const feature = await fetchBAGeometryFeature(baCode);
      return { baCode, area: feature?.area ?? Infinity };
    })
  );

  // Sort by area (smallest first)
  featuresWithAreas.sort((a, b) => a.area - b.area);

  // Log areas for debugging
  console.log(
    "BA areas (sq meters):",
    featuresWithAreas.map((f) => `${f.baCode}: ${f.area.toLocaleString()}`)
  );

  // Apply hardcoded low-priority overlay check as tiebreaker:
  // If the smallest BA is in the low-priority set and the second-smallest is not,
  // and their areas are within 10% of each other, prefer the second one
  if (featuresWithAreas.length >= 2) {
    const smallest = featuresWithAreas[0];
    const secondSmallest = featuresWithAreas[1];
    const areaSimilarityThreshold = 0.1; // 10% difference
    const areSimilar =
      Math.abs(smallest.area - secondSmallest.area) / smallest.area < areaSimilarityThreshold;

    if (
      areSimilar &&
      LOW_PRIORITY_OVERLAY_BAS.has(smallest.baCode) &&
      !LOW_PRIORITY_OVERLAY_BAS.has(secondSmallest.baCode)
    ) {
      console.log(
        `Applying hardcoded priority: preferring ${secondSmallest.baCode} over ${smallest.baCode}`
      );
      return secondSmallest.baCode;
    }
  }

  const selected = featuresWithAreas[0].baCode;
  console.log(`Selected smallest BA: ${selected}`);
  return selected;
}

function getZoneForBA(baCode: string, lat: number, lon: number): string {
  if (!hasPricingData(baCode)) {
    return getRepresentativeZone(baCode) || "";
  }

  return findZoneByCoordinates(baCode, lat, lon) || getRepresentativeZone(baCode) || "";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");

  if (!address) {
    return NextResponse.json({
      iso: null,
      zone: null,
      message: "No address provided",
    });
  }

  try {
    // Use OpenStreetMap Nominatim for free geocoding
    const geocodeUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
      address
    )}&format=json&limit=1&addressdetails=1&countrycodes=us`;

    const response = await fetch(geocodeUrl, {
      headers: {
        "User-Agent": "MixFix-Energy-App",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Geocoding API error: ${response.status} ${response.statusText}`
      );
    }

    const results = await response.json();

    if (!results || results.length === 0) {
      return NextResponse.json(
        { error: "Address not found" },
        { status: 404 }
      );
    }

    const location = results[0];
    const lat = parseFloat(location.lat);
    const lon = parseFloat(location.lon);

    let detectedBA: string | null = null;
    try {
      // Primary path: intersection against canonical control-area polygons.
      detectedBA = await getBAFromGeometryIntersection(lat, lon);
    } catch (geometryError) {
      console.warn("Geometry BA lookup failed; falling back to legacy boxes", geometryError);
    }

    if (detectedBA) {
      return NextResponse.json({
        lat,
        lon,
        display_name: location.display_name,
        address: location.address,
        iso: detectedBA,
        zone: getZoneForBA(detectedBA, lat, lon),
      });
    }

    // Fallback path while legacy boxes are still retained.
    const isoData = getISOFromCoordinates(lat, lon);

    if (!isoData) {
      return NextResponse.json({
        lat,
        lon,
        display_name: location.display_name,
        address: location.address,
        iso: null,
        zone: null,
        message: "Location not within a supported ISO region",
      });
    }

    return NextResponse.json({
      lat,
      lon,
      display_name: location.display_name,
      address: location.address,
      iso: isoData.iso,
      zone: isoData.zone,
    });
  } catch (err) {
    const error = err as Error;
    console.error("Geocoding error:", error.message);
    return NextResponse.json(
      { error: "Failed to geocode address", details: error.message },
      { status: 500 }
    );
  }
}
