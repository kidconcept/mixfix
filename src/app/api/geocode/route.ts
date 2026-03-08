import { NextResponse } from "next/server";
import { getRepresentativeZone } from "@/lib/config/balancing-authorities";
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
    )}&format=json&limit=1&addressdetails=1`;

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

    // Determine ISO region from coordinates
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
