# Plan: Granularity Switcher (Day / Month / Year)

## Summary
Add a Day/Month/Year toggle that replaces the "Date" label above the date picker. Daily = current hourly chart (unchanged). Monthly = one stacked-area point per day of the selected month. Yearly = one stacked-area point per month of the selected year. Fuel mix only — no pricing for monthly/yearly. Integrates with the existing Upstash Redis two-tier cache (L1 in-memory + L2 Redis).

---

## Change Summary

| File | Change | Step |
|------|--------|------|
| `src/lib/config/balancing-authorities.ts` | Add `getEIATimezone()` — IANA → EIA timezone facet mapper | 1 |
| `src/lib/data/eia/fuel.ts` | Add `fetchEIADailyFuelMix()` + `buildDailyParams()` — daily endpoint fetcher | 2 |
| `src/lib/data/eia/fuel.ts` | Add `aggregateToMonthly()` — averages daily records into monthly | 3 |
| `src/lib/data/cache/kv.ts` | Rename `CacheEntry.hours` → `records` | 4 |
| `src/lib/data/cache/kv.ts` | Add `dailyFuelCacheKey()` key builder | 4 |
| `src/app/api/energy/route.ts` | Update existing code for `hours` → `records` rename | 4 |
| `src/app/api/energy/route.ts` | Add `view='monthly'` branch with cache integration | 5, 6 |
| `src/app/api/energy/route.ts` | Add `view='yearly'` branch (no cache) | 6 |
| `src/types/energy.ts` | Add `Granularity` type (`'daily' \| 'monthly' \| 'yearly'`) | 7 |
| `src/app/page.tsx` | Add `granularity` state + Day/Month/Year toggle replacing "Date" label | 8 |
| `src/app/page.tsx` | Update `fuelMixKey` to include `&view=` param; null out `pricingKey` for non-daily | 8 |
| `src/components/CombinedChart.tsx` | Add `granularity` prop; branch `combinedData` builder for daily/monthly/yearly | 9 |
| `src/components/CombinedChart.tsx` | Dynamic XAxis `dataKey`, label, and `tickFormatter` per granularity | 9 |
| `src/components/CombinedChart.tsx` | Hide pricing YAxis + Lines when `granularity !== 'daily'` | 9 |

---

## Phase 1 — Data Layer (EIA Daily Endpoint)

### Step 1: IANA-to-EIA timezone mapper
**File:** `src/lib/config/balancing-authorities.ts`

Add `getEIATimezone(code: string): string` — maps the BA's IANA timezone (from `getBATimezone`) to the EIA daily endpoint's timezone facet value. The EIA daily endpoint returns **one row per timezone per fuel type per day**, so filtering to the correct timezone is mandatory.

Mapping:
- `America/New_York` → `Eastern`
- `America/Chicago` → `Central`
- `America/Denver` → `Mountain`
- `America/Los_Angeles` → `Pacific`
- `America/Phoenix` → `Arizona`
- Fallback → `Eastern` (safe default; most BAs are eastern)

### Step 2: New EIA daily fetcher
**File:** `src/lib/data/eia/fuel.ts`

Add `fetchEIADailyFuelMix(balancingAuthority: string, startDate: string, endDate: string)` alongside the existing `fetchEIAFuelMix`.

- Calls `/v2/electricity/rto/daily-fuel-type-data/data/` (confirmed available, data from 2019-01-01)
- New `buildDailyParams()` function (not reusing `buildParams` — different endpoint shape):
  - No `frequency` param (daily endpoint has only one frequency)
  - `start` / `end` as plain `YYYY-MM-DD` (no UTC conversion needed)
  - `facets[timezone][]` set via `getEIATimezone(ba)` — **critical** to avoid 5x duplicate rows
  - `facets[respondent][]` or `facets[stateid][]` — same logic as hourly, reusing `getEIACode()`
  - `length=4000` to handle full-year requests (~8 fuel types × 366 days = ~2,928 rows max)
- Reuses `FUELTYPEID_MAP` for fuel type mapping
- Transform: groups by `period` (date string), sums fuel values, converts daily MWh ÷ 24 ÷ 1000 → avg GW (matching chart's existing unit)
- Returns `RequestResult<HistoricalRecord[]>` where each record has `date = 'YYYY-MM-DD'`
- Uses `eiaQueue` for timeout/retry/rate-limiting (same 30s timeout, 3 retries)

### Step 3: Server-side monthly aggregation helper
**File:** `src/lib/data/eia/fuel.ts`

Add `aggregateToMonthly(dailyRecords: HistoricalRecord[]): HistoricalRecord[]`

- Groups daily records by month (`YYYY-MM` prefix of `date`)
- Averages each fuel type's GW values across days in that month
- Returns up to 12 records with `date = 'YYYY-MM'`
- Used only for the yearly view; runs in-memory on ~365 records (trivially fast)

---

## Phase 2 — Cache Layer

### Step 4: New cache key builder + rename `hours` to `records`
**File:** `src/lib/data/cache/kv.ts`

**Rename `CacheEntry.hours` → `CacheEntry.records`** — the field is a generic count (hours for daily, days for monthly, months for yearly). Update the interface and all existing usages in `route.ts`.

Add one new key builder:
- `dailyFuelCacheKey(ba, scope)` → `eia:fuel-daily:{BA}:{scope}` where `scope` is `YYYY-MM` (monthly) or `YYYY` (yearly)

Existing `fuelMixCacheKey` and `pricingCacheKey` remain unchanged.

### Step 5: Cache integration in API route monthly view only
**File:** `src/app/api/energy/route.ts`

Monthly view follows the same cache-first pattern as existing views:
1. `cacheGet` with `dailyFuelCacheKey(ba, yearMonth)`
2. `complete` = true when record count equals days in month AND month is in the past
3. If incomplete/miss → fetch → `cacheSet` (update if more records than cached)
4. On fetch failure, serve stale incomplete cache if available

**No caching for yearly view in v1.** The yearly request fetches ~2,920 EIA rows, aggregates to 12 monthly records — fast enough without cache. Avoids caching derived data. Can add later if needed.

---

## Phase 3 — API Route

### Step 6: New view branches
**File:** `src/app/api/energy/route.ts`

Add two new branches before the existing fuel-mix default branch:

**`view='monthly'`:**
- Derive `startDate` = first day of month from `date`, `endDate` = last day of month
- Cache-first with `dailyFuelCacheKey(ba, YYYY-MM)`
- Call `fetchEIADailyFuelMix(ba, startDate, endDate)`
- Cache result (complete if past month with expected day count)
- **Skip `validateFuelMixData`** — it expects hourly `YYYY-MM-DDThh` format and 25-hour completeness. Instead, return a trivial quality object: `{ confidence: records.length > 0 ? 'high' : 'critical', warnings: [], errors: [], missingHours: [], totalHours: records.length, completenessPercent: 100 }`
- Return `{ hourly: result.data, quality, meta: { ..., granularity: 'monthly' } }`

**`view='yearly'`:**
- Derive `startDate = YYYY-01-01`, `endDate = YYYY-12-31` from `date`
- No cache (v1)
- Call `fetchEIADailyFuelMix(ba, startDate, endDate)`
- Server-side: call `aggregateToMonthly(result.data)` → up to 12 monthly avg records
- Same trivial quality object
- Return `{ hourly: aggregated, quality, meta: { ..., granularity: 'yearly' } }`

Both branches require `balancingAuthority` but not `node`. Reuse the `hourly` response key so client SWR shape is unchanged.

---

## Phase 4 — Types

### Step 7: Add Granularity type
**File:** `src/types/energy.ts`

Add: `export type Granularity = 'daily' | 'monthly' | 'yearly'`

No changes to `HistoricalRecord` — it already handles `date: string` generically.

---

## Phase 5 — Page UI (*parallel with Phase 4*)

### Step 8: Granularity toggle and state
**File:** `src/app/page.tsx`

- Add `const [granularity, setGranularity] = useState<Granularity>('daily')`
- **Replace the "Date" `<label>`** above the date input with a 3-button toggle: Day / Month / Year
  - Styled as small inline buttons similar to existing form styling
  - Selected state uses `var(--active)` background; unselected uses transparent
  - Font size matches existing label: `var(--font-form-xs)`
  - The toggle sits in the same `<div className="flex flex-col form-field-block">` that currently holds the Date label + input
- Update `fuelMixKey`:
  - `'daily'` → existing URL (no `view` param, backward compatible)
  - `'monthly'` → append `&view=monthly`
  - `'yearly'` → append `&view=yearly`
- Reset `fuelMixRetryCount` when granularity changes
- Pass `granularity` as new prop to `<CombinedChart>`
- When granularity is not `'daily'`, set `pricingKey = null` (skip pricing SWR fetch)

---

## Phase 6 — Chart (*depends on Phase 5*)

### Step 9: Branched data builder and dynamic x-axis
**File:** `src/components/CombinedChart.tsx`

- Add `granularity?: Granularity` to `CombinedChartProps` (default `'daily'`)
- Replace the single `combinedData` builder with a branch:
  - **`'daily'`** → existing hour-keyed logic (0–24 array), completely unchanged
  - **`'monthly'`** → map `fuelMixData` directly: extract `period = parseInt(date.split('-')[2])` (day 1–31), fuel values used as-is, no charging split (daily avgs don't go negative), no pricing fields
  - **`'yearly'`** → map `fuelMixData` directly: extract `period = parseInt(date.split('-')[1])` (month 1–12), fuel values used as-is, no pricing fields
- XAxis changes:
  - `dataKey`: `'hour'` for daily, `'period'` for monthly/yearly
  - Label text: daily = existing `getFormattedDate()` (only called for daily), monthly = `"Days ({Month} {Year})"`, yearly = `"Months ({Year})"` — derive month name and year from `fuelMixData[0].date`
  - `tickFormatter` for yearly: `(v) => ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][v]`
- Hide pricing `<YAxis yAxisId="price">` and all pricing `<Line>` components when `granularity !== 'daily'`
- Tooltip: for non-daily, show only fuel values (no pricing entries), format values as avg GW

---

## Relevant Files
- `src/lib/config/balancing-authorities.ts` — add `getEIATimezone()` IANA-to-EIA mapper
- `src/lib/data/eia/fuel.ts` — add `fetchEIADailyFuelMix`, `buildDailyParams`, `aggregateToMonthly`; reuse `FUELTYPEID_MAP`, `eiaQueue`, `getEIACode`
- `src/lib/data/cache/kv.ts` — rename `hours` → `records` in `CacheEntry`, add `dailyFuelCacheKey`
- `src/app/api/energy/route.ts` — add `view='monthly'` and `view='yearly'` branches; update existing branches for `hours` → `records` rename; skip `validateFuelMixData` for non-daily
- `src/types/energy.ts` — add `Granularity` type
- `src/app/page.tsx` — granularity state, toggle UI replacing "Date" label, SWR key changes, prop pass
- `src/components/CombinedChart.tsx` — branched data build, dynamic XAxis, hide pricing for non-daily; ensure `getFormattedDate()` only called for daily

## Verification
1. Select a BA (e.g., NYISO), switch to Month → chart shows ~30 points with day numbers on x-axis, no price lines
2. Switch to Year → chart shows 12 points with month abbreviations on x-axis
3. Switch back to Day → existing hourly chart with pricing works unchanged
4. Network tab: one API call per granularity change, no hourly fetches for monthly/yearly
5. Server logs: monthly fetch ~48 EIA rows (8 fuels × ~6 days sample), yearly ~2,920 rows
6. Verify timezone facet: check EIA request URL includes correct `facets[timezone][]=Eastern` (for NYISO) — no 5x duplicate rows
7. Cache monthly: repeat same month request → `[Cache] HIT` in server logs
8. Cache incompleteness: request current month → cached as incomplete; past month → cached as complete
9. Yearly has no cache: repeat request → always fetches from EIA (acceptable for v1)

## Decisions
- **IANA-to-EIA timezone mapping** required — daily endpoint returns 5 rows per timezone without the facet filter
- **Skip `validateFuelMixData`** for non-daily — validator expects hourly format, would produce false `critical` confidence
- **No yearly cache in v1** — avoids caching derived data; ~2,920 row fetch + aggregation is fast enough
- **Rename `CacheEntry.hours` → `records`** — clearer intent across all granularities
- Reusing the `hourly` response key for all granularities avoids SWR/client shape changes
- No pricing data for monthly/yearly (user decision)
- Values normalized to avg GW (daily MWh ÷ 24 ÷ 1000) in fetcher — keeps chart unit consistent
- The `date` input drives all views: monthly derives month, yearly derives year
- Day/Month/Year toggle replaces the "Date" label above the date picker
- `getFormattedDate()` only called for daily granularity — monthly/yearly use separate label logic to avoid regex mismatch on `YYYY-MM` format
