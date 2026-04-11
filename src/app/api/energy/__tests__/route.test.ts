import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HistoricalRecord } from "@/types/energy";
import type { CacheEntry } from "@/lib/data/cache/kv";

// -------------------------------------------------------------------------
// Mocks — define before importing the route handler
// -------------------------------------------------------------------------

// Mock EIA fuel fetcher
vi.mock("@/lib/data/eia/fuel", () => ({
  fetchEIAFuelMix: vi.fn(),
  fetchEIADailyFuelMix: vi.fn(),
  aggregateToMonthly: vi.fn(),
}));

// Mock cache
vi.mock("@/lib/data/cache/kv", () => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  fuelMixCacheKey: (ba: string, date: string) => `eia:fuel:${ba}:${date}`,
  pricingCacheKey: (iso: string, node: string, date: string) =>
    `gs:lmp:v2:${iso}:${node}:${date}`,
  dailyFuelCacheKey: (ba: string, scope: string) =>
    `eia:fuel-daily:${ba}:${scope}`,
  resampledPricingCacheKey: (iso: string, node: string, scope: string) =>
    `gs:lmp-resampled:${iso}:${node}:${scope}`,
}));

// Mock Grid Status pricing
vi.mock("@/lib/data/gridStatus/pricing", () => ({
  fetchGridStatusPricing: vi.fn(),
  fetchGridStatusPricingResampled: vi.fn(),
  isPricingSupported: vi.fn(() => false),
}));

// Mock validation — pass through real-ish shapes
vi.mock("@/lib/data/validation/validator", () => ({
  validateFuelMixData: vi.fn(() => ({
    confidence: "high",
    warnings: [],
    errors: [],
    missingHours: [],
    totalHours: 25,
    completenessPercent: 100,
  })),
  validatePricingData: vi.fn(() => ({
    confidence: "high",
    warnings: [],
    errors: [],
    missingHours: [],
    totalHours: 25,
    completenessPercent: 100,
  })),
  generateQualitySummary: vi.fn(() => "High confidence"),
}));

// Now import the handler and mocked modules
import { GET } from "@/app/api/energy/route";
import { fetchEIAFuelMix } from "@/lib/data/eia/fuel";
import { cacheGet, cacheSet } from "@/lib/data/cache/kv";

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

function makeRequest(params: Record<string, string>): Request {
  const url = new URL("http://localhost:3000/api/energy");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new Request(url.toString());
}

function makeFuelRecords(count: number): HistoricalRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    date: `2024-01-15T${String(i).padStart(2, "0")}`,
    solar: 1.2,
    wind: 0.8,
    gas: 3.0,
  }));
}

// -------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/energy — fuel-mix view", () => {
  const baseParams = { location: "NYISO", date: "2024-01-15" };

  it("returns fresh data on cache miss + successful fetch", async () => {
    vi.mocked(cacheGet).mockResolvedValue(null);
    vi.mocked(fetchEIAFuelMix).mockResolvedValue({
      success: true,
      data: makeFuelRecords(25),
    });
    vi.mocked(cacheSet).mockResolvedValue(undefined);

    const res = await GET(makeRequest(baseParams));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.hourly).toHaveLength(25);
    expect(body.meta.cached).toBe(false);
    expect(body.meta.view).toBe("fuel-mix");
    // Cache should have been written
    expect(cacheSet).toHaveBeenCalledOnce();
  });

  it("returns cached data immediately on complete cache hit", async () => {
    const cached: CacheEntry<HistoricalRecord[]> = {
      data: makeFuelRecords(25),
      records: 25,
      complete: true,
      fetchedAt: "2024-01-15T10:00:00Z",
    };
    vi.mocked(cacheGet).mockResolvedValue(cached);

    const res = await GET(makeRequest(baseParams));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.hourly).toHaveLength(25);
    expect(body.meta.cached).toBe(true);
    expect(body.meta.cacheComplete).toBe(true);
    // Fetch should NOT have been called
    expect(fetchEIAFuelMix).not.toHaveBeenCalled();
  });

  it("serves stale cache when fetch fails", async () => {
    const stale: CacheEntry<HistoricalRecord[]> = {
      data: makeFuelRecords(10),
      records: 10,
      complete: false,
      fetchedAt: "2024-01-15T08:00:00Z",
    };
    vi.mocked(cacheGet).mockResolvedValue(stale);
    vi.mocked(fetchEIAFuelMix).mockResolvedValue({
      success: false,
      error: { type: "network", message: "Connection refused", retryable: true },
    });

    const res = await GET(makeRequest(baseParams));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.hourly).toHaveLength(10);
    expect(body.meta.cached).toBe(true);
    expect(body.meta.cacheComplete).toBe(false);
  });

  it("returns 500 when fetch fails and no cache exists", async () => {
    vi.mocked(cacheGet).mockResolvedValue(null);
    vi.mocked(fetchEIAFuelMix).mockResolvedValue({
      success: false,
      error: { type: "server-error", message: "EIA API 500", retryable: true },
    });

    const res = await GET(makeRequest(baseParams));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBeTruthy();
  });
});
