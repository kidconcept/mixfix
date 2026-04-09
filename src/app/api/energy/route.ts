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
import {
  cacheGet,
  cacheSet,
  pricingCacheKey,
  fuelMixCacheKey,
  type CacheEntry,
} from "@/lib/data/cache/kv";
import type { LMPDataPoint, HistoricalRecord } from "@/types/energy";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const balancingAuthority = searchParams.get("location");
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
      if (!balancingAuthority) {
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
      if (!isPricingSupported(balancingAuthority)) {
        return NextResponse.json(
          { error: `Pricing data not available for ${balancingAuthority}` },
          { status: 400 }
        );
      }

      // Check cache first
      const cacheKey = pricingCacheKey(balancingAuthority, node, date);
      const cached = await cacheGet<LMPDataPoint[]>(cacheKey);

      if (cached?.complete) {
        console.log(`[Cache] HIT (complete) ${cacheKey}`);
        return NextResponse.json({
          lmp: cached.data,
          quality: validatePricingData(cached.data, date),
          meta: {
            source: "grid-status",
            view: "pricing",
            location: balancingAuthority,
            node,
            date,
            summary: generateQualitySummary(validatePricingData(cached.data, date)),
            cached: true,
            cacheComplete: true,
            hours: cached.hours,
          },
        });
      }

      if (cached) {
        console.log(`[Cache] HIT (incomplete, ${cached.hours}/25 hours) ${cacheKey}`);
      } else {
        console.log(`[Cache] MISS ${cacheKey}`);
      }

      // Fetch pricing data
      const result = await fetchGridStatusPricing(balancingAuthority, node, date);

      // Handle fetch errors
      if (!result.success) {
        console.error("Pricing fetch error:", result.error);
        
        // Check if it's a quota exceeded error
        const isQuotaError = result.error.message?.includes('quota exceeded') || 
                            result.error.message?.includes('limit reached');
        
        // If fetch failed but we have stale incomplete cache, serve that
        if (cached) {
          console.log(`[Cache] Serving stale incomplete data after fetch failure ${cacheKey}`);
          return NextResponse.json({
            lmp: cached.data,
            quality: validatePricingData(cached.data, date),
            meta: {
              source: "grid-status",
              view: "pricing",
              location: balancingAuthority,
              node,
              date,
              summary: generateQualitySummary(validatePricingData(cached.data, date)),
              cached: true,
              cacheComplete: false,
              hours: cached.hours,
            },
          });
        }

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

      // Store in cache (update only if we got more hours than before)
      const newHours = result.data.length;
      if (!cached || newHours >= cached.hours) {
        await cacheSet<LMPDataPoint[]>(cacheKey, {
          data: result.data,
          hours: newHours,
          complete: newHours >= 25,
          fetchedAt: new Date().toISOString(),
        });
        console.log(`[Cache] SET ${cacheKey} (${newHours}/25 hours, complete=${newHours >= 25})`);
      }

      // Validate data quality
      const quality = validatePricingData(result.data, date);

      return NextResponse.json({
        lmp: result.data,
        quality,
        meta: {
          source: "grid-status",
          view: "pricing",
          location: balancingAuthority,
          node,
          date,
          summary: generateQualitySummary(quality),
          cached: false,
          cacheComplete: newHours >= 25,
          hours: newHours,
        },
      });
    }

    // =========================================================================
    // FUEL MIX VIEW: EIA only (Architecture V2 decision)
    // =========================================================================
    
    if (!balancingAuthority) {
      return NextResponse.json(
        { error: "Location parameter is required for fuel mix view" },
        { status: 400 }
      );
    }

    // Check cache first
    const fmCacheKey = fuelMixCacheKey(balancingAuthority, date);
    const fmCached = await cacheGet<HistoricalRecord[]>(fmCacheKey);

    if (fmCached?.complete) {
      console.log(`[Cache] HIT (complete) ${fmCacheKey}`);
      const quality = validateFuelMixData(fmCached.data, date);
      return NextResponse.json({
        hourly: fmCached.data,
        quality,
        meta: {
          source: "eia",
          dataSource: "cache",
          view: "fuel-mix",
          location: balancingAuthority,
          date,
          summary: generateQualitySummary(quality),
          recordCount: fmCached.data.length,
          timestamp: fmCached.fetchedAt,
          cached: true,
          cacheComplete: true,
          hours: fmCached.hours,
        },
      });
    }

    if (fmCached) {
      console.log(`[Cache] HIT (incomplete, ${fmCached.hours}/25 hours) ${fmCacheKey}`);
    } else {
      console.log(`[Cache] MISS ${fmCacheKey}`);
    }

    // Fetch fuel mix data from EIA
    const apiStartTime = Date.now();
    console.log(`[API Route] Starting EIA fuel mix fetch...`);
    const result = await fetchEIAFuelMix(balancingAuthority, date);
    console.log(`[API Route] EIA fetch completed in ${Date.now() - apiStartTime}ms`);

    // Handle fetch errors
    if (!result.success) {
      console.error("EIA fuel mix fetch error:", result.error);
      
      // Check if it's a rate limit error
      const isRateLimitError = result.error.message?.includes('rate limit') || 
                               result.error.message?.includes('Too many requests');

      // If fetch failed but we have stale incomplete cache, serve that
      if (fmCached) {
        console.log(`[Cache] Serving stale incomplete data after fetch failure ${fmCacheKey}`);
        const quality = validateFuelMixData(fmCached.data, date);
        return NextResponse.json({
          hourly: fmCached.data,
          quality,
          meta: {
            source: "eia",
            dataSource: "cache",
            view: "fuel-mix",
            location: balancingAuthority,
            date,
            summary: generateQualitySummary(quality),
            recordCount: fmCached.data.length,
            timestamp: fmCached.fetchedAt,
            cached: true,
            cacheComplete: false,
            hours: fmCached.hours,
          },
        });
      }

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

    // Store in cache (update only if we got more hours than before)
    const fmHours = result.data.length;
    if (!fmCached || fmHours >= fmCached.hours) {
      await cacheSet<HistoricalRecord[]>(fmCacheKey, {
        data: result.data,
        hours: fmHours,
        complete: fmHours >= 25,
        fetchedAt: new Date().toISOString(),
      });
      console.log(`[Cache] SET ${fmCacheKey} (${fmHours}/25 hours, complete=${fmHours >= 25})`);
    }

    // Validate data quality
    const quality = validateFuelMixData(result.data, date);

    return NextResponse.json({
      hourly: result.data,
      quality,
      meta: {
        source: "eia",
        dataSource: "eia-api",
        view: "fuel-mix",
        location: balancingAuthority,
        date,
        summary: generateQualitySummary(quality),
        recordCount: result.data.length,
        timestamp: new Date().toISOString(),
        cached: false,
        cacheComplete: fmHours >= 25,
        hours: fmHours,
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
