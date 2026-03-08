import { NextResponse } from "next/server";
import { fetchEIAFuelMix } from "@/lib/data/eia/fuel";
import { 
  fetchGridStatusPricing, 
  isPricingSupported
} from "@/lib/data/gridStatus/pricing";
import { 
  validateFuelMixData, 
  validatePricingData,
  generateQualitySummary,
  type DataQualityReport 
} from "@/lib/data/validation/validator";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const location = searchParams.get("location");
  const date = searchParams.get("date");
  const view = searchParams.get("view"); // Optional: 'fuel-mix' (default) or 'pricing'
  const node = searchParams.get("node"); // Required for pricing view

  // Validate required parameters
  if (!date) {
    return NextResponse.json(
      { error: "Date parameter is required" }, 
      { status: 400 }
    );
  }

  // Validate date format (YYYY-MM-DD)
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(date)) {
    return NextResponse.json(
      { error: "Invalid date format. Expected YYYY-MM-DD" },
      { status: 400 }
    );
  }

  try {
    // =========================================================================
    // PRICING VIEW: Grid Status only
    // =========================================================================
    if (view === "pricing") {
      if (!location) {
        return NextResponse.json(
          { error: "Location parameter is required for pricing view" },
          { status: 400 }
        );
      }

      if (!node) {
        return NextResponse.json(
          { error: "Node parameter is required for pricing view" },
          { status: 400 }
        );
      }

      // Check if pricing is supported for this ISO
      if (!isPricingSupported(location)) {
        return NextResponse.json(
          { error: `Pricing data not available for ${location}` },
          { status: 400 }
        );
      }

      // Fetch pricing data
      const result = await fetchGridStatusPricing(location, node, date);

      // Handle fetch errors
      if (!result.success) {
        console.error("Pricing fetch error:", result.error);
        
        // Check if it's a quota exceeded error
        const isQuotaError = result.error.message?.includes('quota exceeded') || 
                            result.error.message?.includes('limit reached');
        
        return NextResponse.json(
          { 
            error: isQuotaError ? "Grid Status API quota exceeded" : "Failed to fetch pricing data",
            details: result.error.message,
            type: result.error.type,
            api: "Grid Status",
            quotaExceeded: isQuotaError,
          },
          { status: isQuotaError ? 429 : 500 }
        );
      }

      // Validate data quality
      const quality = validatePricingData(result.data, date);

      return NextResponse.json({
        lmp: result.data,
        quality,
        meta: {
          source: "grid-status",
          view: "pricing",
          location,
          node,
          date,
          summary: generateQualitySummary(quality),
        },
      });
    }

    // =========================================================================
    // FUEL MIX VIEW: EIA only (Architecture V2 decision)
    // =========================================================================
    
    if (!location) {
      return NextResponse.json(
        { error: "Location parameter is required for fuel mix view" },
        { status: 400 }
      );
    }

    // Fetch fuel mix data from EIA
    const apiStartTime = Date.now();
    console.log(`[API Route] Starting EIA fuel mix fetch...`);
    const result = await fetchEIAFuelMix(location, date);
    console.log(`[API Route] EIA fetch completed in ${Date.now() - apiStartTime}ms`);

    // Handle fetch errors
    if (!result.success) {
      console.error("EIA fuel mix fetch error:", result.error);
      
      // Check if it's a rate limit error
      const isRateLimitError = result.error.message?.includes('rate limit') || 
                               result.error.message?.includes('Too many requests');
      
      return NextResponse.json(
        { 
          error: isRateLimitError ? "EIA API rate limit exceeded" : "Failed to fetch fuel mix data",
          details: result.error.message,
          type: result.error.type,
          api: "EIA",
          rateLimitExceeded: isRateLimitError,
        },
        { status: isRateLimitError ? 429 : 500 }
      );
    }

    // Validate data quality
    const quality = validateFuelMixData(result.data, date);

    return NextResponse.json({
      hourly: result.data,
      quality,
      meta: {
        source: "eia",
        view: "fuel-mix",
        location,
        date,
        summary: generateQualitySummary(quality),
      },
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
