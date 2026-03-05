import { NextResponse } from "next/server";
import { fetchEIAHourly } from "@/lib/energyData";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const location = searchParams.get("location");
  const date = searchParams.get("date");

  if (!date) {
    return NextResponse.json({ error: "Date parameter is required" }, { status: 400 });
  }

  try {
    const hourly = await fetchEIAHourly(location, date);
    return NextResponse.json({ hourly });
  } catch (err) {
    const error = err as Error;
    console.error("API route error:", error.message);
    return NextResponse.json(
      { error: "Failed to fetch energy data", details: error.message },
      { status: 500 }
    );
  }
}
