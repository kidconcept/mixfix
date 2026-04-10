import { NextResponse } from "next/server";
import { fetchEIAFuelMix, fetchEIADailyFuelMix, aggregateToMonthly } from "@/lib/data/eia/fuel";
import { 
  fetchGridStatusPricing,
  fetchGridStatusPricingResampled,
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
  dailyFuelCacheKey,
  resampledPricingCacheKey,
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
            records: cached.records,
          },
        });
      }

      if (cached) {
        console.log(`[Cache] HIT (incomplete, ${cached.records}/25 hours) ${cacheKey}`);
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
              records: cached.records,
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

      // Store in cache (update only if we got more records than before)
      const newRecords = result.data.length;
      if (!cached || newRecords >= cached.records) {
        await cacheSet<LMPDataPoint[]>(cacheKey, {
          data: result.data,
          records: newRecords,
          complete: newRecords >= 25,
          fetchedAt: new Date().toISOString(),
        });
        console.log(`[Cache] SET ${cacheKey} (${newRecords}/25 hours, complete=${newRecords >= 25})`);
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
          cacheComplete: newRecords >= 25,
          records: newRecords,
        },
      });
    }

    // =========================================================================
    // MONTHLY VIEW: EIA daily + optional Grid Status resampled pricing
    // =========================================================================
    if (view === "monthly") {
      if (!balancingAuthority) {
        return NextResponse.json(
          { error: "Location parameter is required for monthly view" },
          { status: 400 }
        );
      }

      // Derive month boundaries from date
      const [year, month] = date.split("-");
      const yearMonth = `${year}-${month}`;
      const startDate = `${yearMonth}-01`;
      const lastDay = new Date(Number(year), Number(month), 0).getDate();
      const endDate = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;
      const now = new Date();
      const isPastMonth = new Date(Number(year), Number(month), 0) < now;

      // --- Fuel mix (cache-first) ---
      const fmKey = dailyFuelCacheKey(balancingAuthority, yearMonth);
      const fmCached = await cacheGet<HistoricalRecord[]>(fmKey);

      let fuelData: HistoricalRecord[];
      let fuelCached = false;

      if (fmCached?.complete) {
        console.log(`[Cache] HIT (complete) ${fmKey}`);
        fuelData = fmCached.data;
        fuelCached = true;
      } else {
        if (fmCached) {
          console.log(`[Cache] HIT (incomplete, ${fmCached.records}/${lastDay} days) ${fmKey}`);
        } else {
          console.log(`[Cache] MISS ${fmKey}`);
        }

        const fuelResult = await fetchEIADailyFuelMix(balancingAuthority, startDate, endDate);
        if (!fuelResult.success) {
          if (fmCached) {
            console.log(`[Cache] Serving stale incomplete data after fetch failure ${fmKey}`);
            fuelData = fmCached.data;
            fuelCached = true;
          } else {
            return NextResponse.json(
              { error: "Failed to fetch monthly fuel mix data", details: fuelResult.error.message },
              { status: 500 }
            );
          }
        } else {
          fuelData = fuelResult.data;
          const fuelRecords = fuelData.length;
          if (!fmCached || fuelRecords >= fmCached.records) {
            await cacheSet<HistoricalRecord[]>(fmKey, {
              data: fuelData,
              records: fuelRecords,
              complete: isPastMonth && fuelRecords >= lastDay,
              fetchedAt: new Date().toISOString(),
            });
            console.log(`[Cache] SET ${fmKey} (${fuelRecords}/${lastDay} days, complete=${isPastMonth && fuelRecords >= lastDay})`);
          }
        }
      }

      // --- Pricing (optional, cache-first) ---
      let pricingData: LMPDataPoint[] | undefined;
      if (node && isPricingSupported(balancingAuthority)) {
        const pKey = resampledPricingCacheKey(balancingAuthority, node, yearMonth);
        const pCached = await cacheGet<LMPDataPoint[]>(pKey);

        if (pCached?.complete) {
          console.log(`[Cache] HIT (complete) ${pKey}`);
          pricingData = pCached.data;
        } else {
          const pResult = await fetchGridStatusPricingResampled(
            balancingAuthority, node, startDate, endDate, "1 day"
          );
          if (pResult.success) {
            pricingData = pResult.data;
            const pRecords = pricingData.length;
            if (!pCached || pRecords >= pCached.records) {
              await cacheSet<LMPDataPoint[]>(pKey, {
                data: pricingData,
                records: pRecords,
                complete: isPastMonth && pRecords >= lastDay,
                fetchedAt: new Date().toISOString(),
              });
              console.log(`[Cache] SET ${pKey} (${pRecords}/${lastDay} days)`);
            }
          } else if (pCached) {
            pricingData = pCached.data;
          }
          // If fetch fails and no cache, pricing is simply omitted
        }
      }

      return NextResponse.json({
        hourly: fuelData,
        ...(pricingData && { lmp: pricingData }),
        quality: {
          confidence: fuelData.length > 0 ? "high" : "critical",
          warnings: [],
          errors: [],
          missingHours: [],
          totalHours: fuelData.length,
          completenessPercent: 100,
        },
        meta: {
          source: "eia",
          view: "monthly",
          granularity: "monthly",
          location: balancingAuthority,
          date,
          recordCount: fuelData.length,
          cached: fuelCached,
          records: fuelData.length,
          hasPricing: !!pricingData,
        },
      });
    }

    // =========================================================================
    // YEARLY VIEW: EIA daily → aggregate + optional Grid Status resampled pricing
    // =========================================================================
    if (view === "yearly") {
      if (!balancingAuthority) {
        return NextResponse.json(
          { error: "Location parameter is required for yearly view" },
          { status: 400 }
        );
      }

      const year = date.split("-")[0];
      const startDate = `${year}-01-01`;
      const endDate = `${year}-12-31`;
      const isPastYear = Number(year) < new Date().getFullYear();

      // --- Fuel mix (no cache in v1 — fetch + aggregate) ---
      const fuelResult = await fetchEIADailyFuelMix(balancingAuthority, startDate, endDate);
      let fuelData: HistoricalRecord[];

      if (!fuelResult.success) {
        return NextResponse.json(
          { error: "Failed to fetch yearly fuel mix data", details: fuelResult.error.message },
          { status: 500 }
        );
      }

      fuelData = aggregateToMonthly(fuelResult.data);

      // --- Pricing (optional, cached) ---
      let pricingData: LMPDataPoint[] | undefined;
      if (node && isPricingSupported(balancingAuthority)) {
        const pKey = resampledPricingCacheKey(balancingAuthority, node, year);
        const pCached = await cacheGet<LMPDataPoint[]>(pKey);

        if (pCached?.complete) {
          console.log(`[Cache] HIT (complete) ${pKey}`);
          pricingData = pCached.data;
        } else {
          const pResult = await fetchGridStatusPricingResampled(
            balancingAuthority, node, startDate, endDate, "1 month"
          );
          if (pResult.success) {
            pricingData = pResult.data;
            const pRecords = pricingData.length;
            if (!pCached || pRecords >= pCached.records) {
              await cacheSet<LMPDataPoint[]>(pKey, {
                data: pricingData,
                records: pRecords,
                complete: isPastYear && pRecords >= 12,
                fetchedAt: new Date().toISOString(),
              });
              console.log(`[Cache] SET ${pKey} (${pRecords}/12 months)`);
            }
          } else if (pCached) {
            pricingData = pCached.data;
          }
        }
      }

      return NextResponse.json({
        hourly: fuelData,
        ...(pricingData && { lmp: pricingData }),
        quality: {
          confidence: fuelData.length > 0 ? "high" : "critical",
          warnings: [],
          errors: [],
          missingHours: [],
          totalHours: fuelData.length,
          completenessPercent: 100,
        },
        meta: {
          source: "eia",
          view: "yearly",
          granularity: "yearly",
          location: balancingAuthority,
          date,
          recordCount: fuelData.length,
          cached: false,
          records: fuelData.length,
          hasPricing: !!pricingData,
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
          records: fmCached.records,
        },
      });
    }

    if (fmCached) {
      console.log(`[Cache] HIT (incomplete, ${fmCached.records}/25 hours) ${fmCacheKey}`);
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
            records: fmCached.records,
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

    // Store in cache (update only if we got more records than before)
    const fmRecords = result.data.length;
    if (!fmCached || fmRecords >= fmCached.records) {
      await cacheSet<HistoricalRecord[]>(fmCacheKey, {
        data: result.data,
        records: fmRecords,
        complete: fmRecords >= 25,
        fetchedAt: new Date().toISOString(),
      });
      console.log(`[Cache] SET ${fmCacheKey} (${fmRecords}/25 hours, complete=${fmRecords >= 25})`);
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
        cacheComplete: fmRecords >= 25,
        records: fmRecords,
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
