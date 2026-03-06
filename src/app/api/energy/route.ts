import { NextResponse } from "next/server";
import { fetchEIAHourly } from "@/lib/energyData";
import { fetchGridStatusHourly, isGridStatusSupported } from "@/lib/gridStatusData";
import { fetchLMPHourly, isLMPSupported } from "@/lib/lmpData";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const location = searchParams.get("location");
  const date = searchParams.get("date");
  const source = searchParams.get("source"); // Optional: 'grid-status' or 'eia'
  const view = searchParams.get("view"); // Optional: 'fuel-mix' (default) or 'pricing'
  const node = searchParams.get("node"); // Required for pricing view

  if (!date) {
    return NextResponse.json({ error: "Date parameter is required" }, { status: 400 });
  }

  try {
    // Handle pricing view
    if (view === "pricing") {
      if (!node) {
        return NextResponse.json(
          { error: "Node parameter is required for pricing view" },
          { status: 400 }
        );
      }

      if (!location) {
        return NextResponse.json(
          { error: "Location parameter is required for pricing view" },
          { status: 400 }
        );
      }

      if (!isLMPSupported(location)) {
        return NextResponse.json(
          { error: `LMP data not available for ${location}` },
          { status: 400 }
        );
      }

      const lmpData = await fetchLMPHourly(location, node, date);
      return NextResponse.json({
        lmp: lmpData,
        meta: {
          source: "grid-status",
          view: "pricing",
          location,
          node,
          date,
        },
      });
    }

    // Handle fuel mix view (default)
    let hourly;
    let dataSource;

    // If source is explicitly specified, use that
    if (source === "eia") {
      hourly = await fetchEIAHourly(location, date);
      dataSource = "eia";
    } else if (source === "grid-status") {
      hourly = await fetchGridStatusHourly(location, date);
      dataSource = "grid-status";
    } else {
      // Auto-select: try Grid Status first if supported, fall back to EIA
      if (isGridStatusSupported(location)) {
        try {
          hourly = await fetchGridStatusHourly(location, date);
          dataSource = "grid-status";
        } catch (gridError) {
          console.warn("Grid Status failed, falling back to EIA:", gridError);
          hourly = await fetchEIAHourly(location, date);
          dataSource = "eia";
        }
      } else {
        // Grid Status not supported for this location, use EIA
        hourly = await fetchEIAHourly(location, date);
        dataSource = "eia";
      }
    }

    return NextResponse.json({ 
      hourly,
      meta: {
        source: dataSource,
        view: "fuel-mix",
        location: location || "all",
        date,
      }
    });
  } catch (err) {
    const error = err as Error;
    console.error("API route error:", error.message);
    return NextResponse.json(
      { error: "Failed to fetch energy data", details: error.message },
      { status: 500 }
    );
  }
}
