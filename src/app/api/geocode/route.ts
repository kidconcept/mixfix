import { NextResponse } from "next/server";

// Map coordinates to ISO/RTO regions based on approximate geographic boundaries
// Returns both the ISO and potentially a zone/node for pricing data
function getISOFromCoordinates(lat: number, lon: number): {
  iso: string;
  zone?: string;
  suggestedNode?: string;
} | null {
  // NYISO - New York State
  if (lat >= 40.5 && lat <= 45.0 && lon >= -79.8 && lon <= -71.8) {
    // Zone mapping for NYISO based on location
    // These zones can be used as node names in pricing queries
    let zone: string;
    let suggestedNode: string;
    
    // NYC area (southern tip of Manhattan to northern Bronx)
    if (lat >= 40.5 && lat <= 40.9 && lon >= -74.05 && lon <= -73.7) {
      zone = "NYC";
      suggestedNode = "N.Y.C.";
    }
    // Long Island
    else if (lat >= 40.6 && lat <= 41.0 && lon >= -73.7 && lon <= -71.8) {
      zone = "LONGIL";
      suggestedNode = "LONGIL";
    }
    // Hudson Valley (between NYC and Albany)
    else if (lat >= 40.9 && lat <= 42.3 && lon >= -74.5 && lon <= -73.6) {
      zone = "HUD VL";
      suggestedNode = "HUD VL";
    }
    // Capital region (Albany area)
    else if (lat >= 42.3 && lat <= 43.0 && lon >= -74.2 && lon <= -73.3) {
      zone = "CAPITL";
      suggestedNode = "CAPITL";
    }
    // Genesee (Western NY, Buffalo area)
    else if (lat >= 42.5 && lat <= 43.5 && lon >= -79.8 && lon <= -77.5) {
      zone = "GENESE";
      suggestedNode = "GENESE";
    }
    // Central NY (Syracuse area)
    else if (lat >= 42.5 && lat <= 43.5 && lon >= -76.5 && lon <= -75.5) {
      zone = "CENTRL";
      suggestedNode = "CENTRL";
    }
    // North (Adirondacks and far northern NY)
    else if (lat >= 43.5 && lat <= 45.0) {
      zone = "NORTH";
      suggestedNode = "NORTH";
    }
    // Default to CENTRL for anything else in NY
    else {
      zone = "CENTRL";
      suggestedNode = "CENTRL";
    }
    
    return { iso: "NYISO", zone, suggestedNode };
  }

  // ISONE - New England (CT, MA, ME, NH, RI, VT)
  if (lat >= 41.0 && lat <= 47.5 && lon >= -73.5 && lon <= -66.9) {
    return { iso: "ISONE", suggestedNode: ".H.INTERNAL_HUB" };
  }

  // PJM - Mid-Atlantic/Midwest (PA, NJ, MD, DE, VA, WV, OH, IL, parts of others)
  if (
    (lat >= 37.5 && lat <= 42.5 && lon >= -83.0 && lon <= -74.0) ||
    (lat >= 38.0 && lat <= 40.5 && lon >= -91.5 && lon <= -87.5)
  ) {
    return { iso: "PJM", suggestedNode: "PJM" };
  }

  // MISO - Midwest (15 states from Manitoba to Louisiana)
  if (
    (lat >= 38.0 && lat <= 49.0 && lon >= -104.0 && lon <= -84.0) ||
    (lat >= 29.0 && lat <= 33.0 && lon >= -93.0 && lon <= -88.5)
  ) {
    // Check if it's not already covered by other ISOs
    if (!(lat >= 40.5 && lat <= 45.0 && lon >= -79.8 && lon <= -71.8)) {
      return { iso: "MISO", suggestedNode: "MISO" };
    }
  }

  // SPP - Great Plains (Kansas, Oklahoma, parts of surrounding states)
  if (lat >= 33.5 && lat <= 43.0 && lon >= -106.0 && lon <= -90.0) {
    return { iso: "SPP", suggestedNode: "SPPNORTH_HUB" };
  }

  // ERCOT - Texas (most of the state)
  if (lat >= 25.8 && lat <= 36.5 && lon >= -106.6 && lon <= -93.5) {
    return { iso: "ERCOT", suggestedNode: "HB_HOUSTON" };
  }

  // CAISO - California
  if (lat >= 32.5 && lat <= 42.0 && lon >= -124.5 && lon <= -114.1) {
    return { iso: "CAISO", suggestedNode: "TH_SP15_GEN-APND" };
  }

  return null;
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
      suggestedNode: isoData.suggestedNode,
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
