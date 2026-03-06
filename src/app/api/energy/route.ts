import { NextResponse } from "next/server";
import { fetchEIAHourly } from "@/lib/energyData";
import { fetchGridStatusHourly, isGridStatusSupported } from "@/lib/gridStatusData";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const location = searchParams.get("location");
  const date = searchParams.get("date");
  const source = searchParams.get("source"); // Optional: 'grid-status' or 'eia'

  if (!date) {
    return NextResponse.json({ error: "Date parameter is required" }, { status: 400 });
  }

  try {
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
