# MixFix Data Architecture V2

**Strategy:** Clean separation of data sources with robust error handling and validation

---

## Core Principles

1. **EIA for Fuel Mix** - Nationwide BA coverage, generous rate limits, hourly frequency parameter
2. **Grid Status for Pricing** - Node-level LMP data, real-time updates
3. **Fail Fast, Fail Gracefully** - Timeout/retry with clear error messages
4. **Validate Everything** - No silent failures, no zero-masking
5. **Type-Safe** - Discriminated unions for error states
6. **Observable** - Log everything, report quality metrics

---

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Client Request                       │
│              GET /api/energy?location=NYISO&date=...         │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                      API Route Handler                       │
│  • Parse & validate params                                   │
│  • Check cache (hot path)                                    │
│  • Parallel fetch: [Fuel Mix, Pricing]                      │
│  • Validate both responses                                   │
│  • Return with quality metrics                               │
└───────────┬─────────────────────────────┬───────────────────┘
            │                             │
            ▼                             ▼
┌──────────────────────┐    ┌──────────────────────────────┐
│   EIA Fuel Fetcher   │    │  Grid Status Price Fetcher   │
│                      │    │                              │
│  • Request queue     │    │  • Request queue             │
│  • Timeout: 30s      │    │  • Timeout: 30s              │
│  • Retry: 3x expo    │    │  • Retry: 3x expo            │
│  • frequency=hourly  │    │  • Node-level queries        │
│  • Returns 24 points │    │  • Pagination (if needed)    │
└──────────┬───────────┘    └─────────────┬────────────────┘
           │                              │
           ▼                              ▼
┌──────────────────────┐    ┌──────────────────────────────┐
│  Data Validator      │    │  Data Validator              │
│                      │    │                              │
│  • 24 hours present? │    │  • 24 hours present?         │
│  • Values in range?  │    │  • Prices reasonable?        │
│  • Null vs zero?     │    │  • Negative prices flagged   │
│  • Quality report    │    │  • Quality report            │
└──────────┬───────────┘    └─────────────┬────────────────┘
           │                              │
           └──────────────┬───────────────┘
                          ▼
                ┌──────────────────┐
                │   Cache Layer    │
                │  TTL by quality  │
                │  High: 24h       │
                │  Medium: 30m     │
                │  Low: 5m         │
                └──────────────────┘
```

---

## File Structure

```
src/
├── lib/
│   ├── data/
│   │   ├── eia/
│   │   │   ├── client.ts        # EIA API client with queue
│   │   │   ├── fuel.ts          # Fuel mix fetching
│   │   │   └── types.ts         # EIA-specific types
│   │   ├── gridStatus/
│   │   │   ├── client.ts        # Grid Status API client
│   │   │   ├── pricing.ts       # LMP data fetching
│   │   │   └── types.ts         # Grid Status types
│   │   ├── validation/
│   │   │   ├── validator.ts     # Data quality validation
│   │   │   ├── sanitizer.ts     # Null/zero handling
│   │   │   └── types.ts         # Quality report types
│   │   ├── cache/
│   │   │   ├── cache.ts         # Smart caching layer
│   │   │   └── keys.ts          # Cache key generation
│   │   └── queue/
│   │       ├── requestQueue.ts  # Rate limiting queue
│   │       └── retry.ts         # Exponential backoff
│   └── utils/
│       ├── timeout.ts           # Timeout wrapper
│       └── timezone.ts          # (existing)
└── app/
    └── api/
        └── energy/
            └── route.ts         # Unified API handler
```

---

## Core Implementation

### 1. Request Queue with Timeout & Retry

**File:** `src/lib/data/queue/requestQueue.ts`

```typescript
export interface RequestOptions {
  timeout?: number;        // Default: 30000ms
  retries?: number;        // Default: 3
  retryDelay?: number;     // Default: 1000ms (exponential)
  priority?: 'high' | 'normal' | 'low';
}

export interface RequestResult<T> {
  success: true;
  data: T;
  duration: number;
  retryCount: number;
} | {
  success: false;
  error: string;
  errorType: 'timeout' | 'network' | 'rate_limit' | 'invalid_response' | 'unknown';
  duration: number;
  retryCount: number;
}

export class APIRequestQueue {
  private queue: PriorityQueue<QueuedRequest>;
  private processing: boolean = false;
  private lastRequestTime: number = 0;
  private minInterval: number;
  private stats: RequestStats;
  
  constructor(minIntervalMs: number = 500) {
    this.minInterval = minIntervalMs;
    this.queue = new PriorityQueue();
    this.stats = createStats();
  }
  
  async request<T>(
    fn: () => Promise<T>,
    options: RequestOptions = {}
  ): Promise<RequestResult<T>> {
    const {
      timeout = 30000,
      retries = 3,
      retryDelay = 1000,
      priority = 'normal'
    } = options;
    
    let lastError: Error | null = null;
    let retryCount = 0;
    const startTime = Date.now();
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        const delay = retryDelay * Math.pow(2, attempt - 1);
        await this.sleep(delay);
        retryCount++;
      }
      
      try {
        const data = await this.executeWithTimeout(fn, timeout);
        const duration = Date.now() - startTime;
        
        this.stats.recordSuccess(duration);
        
        return {
          success: true,
          data,
          duration,
          retryCount
        };
      } catch (error) {
        lastError = error as Error;
        
        const errorType = this.classifyError(error);
        
        // Don't retry on certain errors
        if (errorType === 'invalid_response') {
          break;
        }
        
        // For rate limits, use longer delay
        if (errorType === 'rate_limit' && attempt < retries) {
          await this.sleep(15000); // 15s for rate limits
        }
      }
    }
    
    const duration = Date.now() - startTime;
    const errorType = this.classifyError(lastError);
    
    this.stats.recordFailure(errorType);
    
    return {
      success: false,
      error: lastError?.message || 'Unknown error',
      errorType,
      duration,
      retryCount
    };
  }
  
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    // Wait for rate limit
    await this.waitForRateLimit();
    
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Request timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      
      fn()
        .then(result => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }
  
  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.minInterval) {
      const waitTime = this.minInterval - timeSinceLastRequest;
      await this.sleep(waitTime);
    }
    
    this.lastRequestTime = Date.now();
  }
  
  private classifyError(error: unknown): RequestResult<never>['errorType'] {
    const message = (error as Error)?.message?.toLowerCase() || '';
    
    if (message.includes('timeout')) return 'timeout';
    if (message.includes('rate limit') || message.includes('429')) return 'rate_limit';
    if (message.includes('network') || message.includes('fetch')) return 'network';
    if (message.includes('invalid') || message.includes('parse')) return 'invalid_response';
    
    return 'unknown';
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  getStats() {
    return { ...this.stats };
  }
}

// Singleton instances
export const eiaQueue = new APIRequestQueue(200);  // 5 req/sec
export const gridStatusQueue = new APIRequestQueue(500);  // 2 req/sec
```

---

### 2. EIA Fuel Mix Client (with frequency=hourly)

**File:** `src/lib/data/eia/fuel.ts`

```typescript
import { eiaQueue } from '../queue/requestQueue';
import { HistoricalRecord, EnergySource } from '@/types/energy';

const EIA_BASE = "https://api.eia.gov/v2";
const EIA_ENDPOINT = `${EIA_BASE}/electricity/rto/fuel-type-data/data/`;

interface EIAParams {
  apiKey: string;
  location: string;
  date: string;  // YYYY-MM-DD
}

interface EIAResponse {
  response: {
    data: Array<{
      period: string;      // "2026-03-05T00"
      respondent: string;  // "NYIS"
      fueltype: string;    // "NG", "NUC", etc.
      value: number;       // MW
    }>;
  };
}

const FUEL_TYPE_MAP: Record<string, EnergySource> = {
  COL: "coal",
  NG: "gas",
  NUC: "nuclear",
  WAT: "hydro",
  SUN: "solar",
  WND: "wind",
  OIL: "oil",
  OTH: "other",
};

const BA_MAP: Record<string, string> = {
  NYISO: "NYIS",
  CAISO: "CISO",
  ERCOT: "ERCO",
  ISONE: "ISNE",
  MISO: "MISO",
  PJM: "PJM",
  SPP: "SWPP",
};

export async function fetchEIAFuelMix(
  location: string,
  date: string
): Promise<HistoricalRecord[] | null> {
  const apiKey = process.env.EIA_API_KEY;
  
  if (!apiKey) {
    console.warn('EIA_API_KEY not configured, cannot fetch fuel mix data');
    return null;
  }
  
  const ba = BA_MAP[location.toUpperCase()];
  if (!ba) {
    console.warn(`No EIA BA mapping for location: ${location}`);
    return null;
  }
  
  // Build query parameters
  const params = new URLSearchParams();
  params.set('api_key', apiKey);
  params.append('data[0]', 'value');
  params.set('frequency', 'hourly');  // ⭐ Request hourly data directly
  params.set('start', `${date}T00`);
  params.set('end', `${date}T23`);
  params.append('facets[respondent][]', ba);
  params.set('sort[0][column]', 'period');
  params.set('sort[0][direction]', 'asc');
  params.set('length', '200');  // 8 fuel types × 24 hours = 192 max
  
  const url = `${EIA_ENDPOINT}?${params}`;
  
  console.log(`[EIA] Fetching fuel mix for ${location} (BA: ${ba}) on ${date}`);
  
  // Use request queue with timeout and retry
  const result = await eiaQueue.request<EIAResponse>(
    () => fetch(url).then(async (res) => {
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`EIA API error ${res.status}: ${text}`);
      }
      return res.json();
    }),
    {
      timeout: 30000,
      retries: 3,
      retryDelay: 2000,
    }
  );
  
  if (!result.success) {
    console.error(`[EIA] Failed to fetch fuel mix: ${result.error} (${result.errorType})`);
    return null;
  }
  
  const rows = result.data.response?.data || [];
  
  if (rows.length === 0) {
    console.warn(`[EIA] No data returned for ${location} on ${date}`);
    return null;
  }
  
  console.log(`[EIA] Received ${rows.length} data points in ${result.duration}ms (${result.retryCount} retries)`);
  
  // Check for truncation warning
  if (rows.length >= 200) {
    console.warn(`[EIA] Response may be truncated (200 rows returned)`);
  }
  
  // Aggregate by hour
  const hourlyData: { [hour: string]: Partial<Record<EnergySource, number>> } = {};
  
  for (const row of rows) {
    const hour = row.period;
    
    // Validate hour is within requested date
    if (!hour || !hour.startsWith(date)) {
      continue;
    }
    
    if (!hourlyData[hour]) {
      hourlyData[hour] = {};
    }
    
    const source: EnergySource = FUEL_TYPE_MAP[row.fueltype] || "other";
    const currentValue = hourlyData[hour][source] || 0;
    
    // Convert MW to GW
    hourlyData[hour][source] = currentValue + (row.value / 1000);
  }
  
  // Convert to array with null for missing values (not zero-fill)
  const records: HistoricalRecord[] = [];
  
  for (let hour = 0; hour < 24; hour++) {
    const timestamp = `${date}T${String(hour).padStart(2, '0')}`;
    const data = hourlyData[timestamp];
    
    if (data) {
      // Has data - use actual values (may be 0 for some sources)
      records.push({
        date: timestamp,
        solar: data.solar ?? null,
        wind: data.wind ?? null,
        hydro: data.hydro ?? null,
        coal: data.coal ?? null,
        gas: data.gas ?? null,
        nuclear: data.nuclear ?? null,
        oil: data.oil ?? null,
        other: data.other ?? null,
        // EIA doesn't provide these, always null
        geothermal: null,
        biomass: null,
        batteries: null,
        imports: null,
      });
    } else {
      // No data for this hour - all null
      records.push({
        date: timestamp,
        solar: null,
        wind: null,
        hydro: null,
        geothermal: null,
        biomass: null,
        batteries: null,
        imports: null,
        other: null,
        coal: null,
        gas: null,
        oil: null,
        nuclear: null,
      });
    }
  }
  
  return records;
}
```

---

### 3. Grid Status Pricing Client (simplified)

**File:** `src/lib/data/gridStatus/pricing.ts`

```typescript
import { gridStatusQueue } from '../queue/requestQueue';
import { LMPDataPoint } from '@/types/energy';
import { convertUTCToLocalHour, convertUTCToLocalDate } from '@/lib/timezone';

const GRID_STATUS_BASE = "https://api.gridstatus.io/v1";

const LMP_DATASETS: Record<string, string> = {
  NYISO: "nyiso_lmp_real_time_hourly",
  ISONE: "isone_lmp_real_time_hourly_final",
  PJM: "pjm_lmp_real_time_hourly",
  MISO: "miso_lmp_real_time_hourly_final",
  CAISO: "caiso_lmp_real_time_15_min",
  ERCOT: "ercot_lmp_by_settlement_point",
  SPP: "spp_lmp_real_time_5_min",
};

interface GridStatusResponse {
  status_code: number;
  data: Array<{
    interval_start_utc: string;
    interval_end_utc: string;
    lmp: number;
    energy: number;
    congestion: number;
    loss: number;
    location: string;
  }>;
  meta: {
    page: number;
    hasNextPage: boolean;
  };
}

export async function fetchGridStatusPricing(
  location: string,
  node: string,
  date: string
): Promise<LMPDataPoint[] | null> {
  const apiKey = process.env.GRID_API_KEY;
  
  if (!apiKey) {
    console.warn('GRID_API_KEY not configured, cannot fetch pricing data');
    return null;
  }
  
  const dataset = LMP_DATASETS[location.toUpperCase()];
  if (!dataset) {
    console.warn(`No Grid Status pricing dataset for location: ${location}`);
    return null;
  }
  
  // Calculate UTC time window
  const localDate = new Date(date + 'T00:00:00');
  const startTime = new Date(localDate.getTime() - 12 * 60 * 60 * 1000).toISOString();
  const endTime = new Date(localDate.getTime() + 36 * 60 * 60 * 1000).toISOString();
  
  const url = `${GRID_STATUS_BASE}/datasets/${dataset}/query?start_time=${startTime}&end_time=${endTime}&location=${encodeURIComponent(node)}`;
  
  console.log(`[GridStatus] Fetching pricing for ${location}/${node} on ${date}`);
  
  // Fetch with timeout and retry
  const result = await gridStatusQueue.request<GridStatusResponse>(
    () => fetch(url, {
      headers: { 'x-api-key': apiKey },
    }).then(async (res) => {
      if (!res.ok) {
        if (res.status === 429) {
          throw new Error('Rate limit exceeded');
        }
        const text = await res.text();
        throw new Error(`Grid Status API error ${res.status}: ${text}`);
      }
      return res.json();
    }),
    {
      timeout: 30000,
      retries: 3,
      retryDelay: 2000,
    }
  );
  
  if (!result.success) {
    console.error(`[GridStatus] Failed to fetch pricing: ${result.error} (${result.errorType})`);
    return null;
  }
  
  const { data, meta } = result.data;
  
  if (!data || data.length === 0) {
    console.warn(`[GridStatus] No pricing data returned for ${location}/${node} on ${date}`);
    return null;
  }
  
  console.log(`[GridStatus] Received ${data.length} data points in ${result.duration}ms`);
  
  // TODO: Handle pagination if hasNextPage is true
  if (meta.hasNextPage) {
    console.warn(`[GridStatus] Pagination not yet implemented - some pricing data may be missing`);
  }
  
  // Aggregate to hourly
  const hourlyMap = new Map<number, LMPDataPoint[]>();
  
  for (const point of data) {
    const localDate = convertUTCToLocalDate(point.interval_start_utc, location);
    
    if (localDate !== date) continue;
    
    const localHour = convertUTCToLocalHour(point.interval_start_utc, location);
    
    if (!hourlyMap.has(localHour)) {
      hourlyMap.set(localHour, []);
    }
    
    hourlyMap.get(localHour)!.push({
      time: point.interval_start_utc,
      lmp: point.lmp,
      energy: point.energy,
      congestion: point.congestion,
      loss: point.loss,
    });
  }
  
  // Average sub-hourly data to hourly
  const hourlyData: LMPDataPoint[] = [];
  
  for (let hour = 0; hour < 24; hour++) {
    const points = hourlyMap.get(hour);
    
    if (points && points.length > 0) {
      const count = points.length;
      const avgLMP = points.reduce((sum, p) => sum + p.lmp, 0) / count;
      const avgEnergy = points.reduce((sum, p) => sum + p.energy, 0) / count;
      const avgCongestion = points.reduce((sum, p) => sum + p.congestion, 0) / count;
      const avgLoss = points.reduce((sum, p) => sum + p.loss, 0) / count;
      
      hourlyData.push({
        time: `${date}T${String(hour).padStart(2, '0')}:00:00`,
        lmp: Number(avgLMP.toFixed(2)),
        energy: Number(avgEnergy.toFixed(2)),
        congestion: Number(avgCongestion.toFixed(2)),
        loss: Number(avgLoss.toFixed(2)),
      });
    }
    // Note: NO zero-fill for missing hours - they stay missing
  }
  
  return hourlyData.sort((a, b) => a.time.localeCompare(b.time));
}
```

---

### 4. Unified Data Validator

**File:** `src/lib/data/validation/validator.ts`

```typescript
import { HistoricalRecord, LMPDataPoint, EnergySource } from '@/types/energy';

export interface DataQualityReport {
  hoursPresent: number;
  totalHours: number;
  hoursMissing: number[];
  hoursWithIssues: number[];
  totalGeneration: number | null;
  avgGenerationPerHour: number | null;
  avgPrice: number | null;
  priceRange: [number, number] | null;
  confidence: 'high' | 'medium' | 'low' | 'critical';
  warnings: string[];
  errors: string[];
  timestamp: string;
}

export function validateFuelMixData(
  records: HistoricalRecord[],
  location?: string
): DataQualityReport {
  const totalHours = 24;
  const hoursMissing: number[] = [];
  const hoursWithIssues: number[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  
  // Build hour map
  const hourMap = new Map<number, HistoricalRecord>();
  records.forEach(record => {
    const hourMatch = record.date.match(/T(\d{2})/);
    if (hourMatch) {
      hourMap.set(parseInt(hourMatch[1], 10), record);
    }
  });
  
  let totalGeneration = 0;
  let hoursWithData = 0;
  
  for (let hour = 0; hour < totalHours; hour++) {
    const record = hourMap.get(hour);
    
    if (!record) {
      hoursMissing.push(hour);
      errors.push(`Missing record for hour ${hour}:00`);
      continue;
    }
    
    // Check if all values are null (no data)
    const sources: EnergySource[] = ['solar', 'wind', 'hydro', 'nuclear', 'gas', 'coal', 'oil', 'other'];
    const allNull = sources.every(s => record[s] === null);
    
    if (allNull) {
      hoursMissing.push(hour);
      warnings.push(`No data for hour ${hour}:00 (all values null)`);
      continue;
    }
    
    // Calculate total (treating null as 0 for calculation only)
    const total = sources.reduce((sum, s) => {
      const val = record[s];
      return sum + (typeof val === 'number' ? val : 0);
    }, 0);
    
    totalGeneration += total;
    hoursWithData++;
    
    // Flag suspicious values
    if (total < 0.5) {
      hoursWithIssues.push(hour);
      warnings.push(`Very low generation at hour ${hour}:00 (${total.toFixed(1)} GW)`);
    }
    
    if (total > 200) {
      hoursWithIssues.push(hour);
      warnings.push(`Unusually high generation at hour ${hour}:00 (${total.toFixed(1)} GW)`);
    }
    
    // Location-specific checks
    if (location) {
      const nuclearRegions = ['NYISO', 'ISONE', 'PJM', 'SPP'];
      if (nuclearRegions.includes(location.toUpperCase())) {
        const nuc = record.nuclear;
        if (typeof nuc === 'number' && nuc < 0.1) {
          warnings.push(`Nuclear unexpectedly low at hour ${hour}:00 in ${location}`);
        }
      }
    }
  }
  
  // Determine confidence
  let confidence: DataQualityReport['confidence'];
  if (hoursMissing.length === 0 && errors.length === 0) {
    confidence = 'high';
  } else if (hoursMissing.length <= 3) {
    confidence = 'medium';
  } else if (hoursMissing.length <= 8) {
    confidence = 'low';
  } else {
    confidence = 'critical';
    errors.push(`Too many missing hours (${hoursMissing.length}/24)`);
  }
  
  return {
    hoursPresent: hoursWithData,
    totalHours,
    hoursMissing,
    hoursWithIssues,
    totalGeneration: hoursWithData > 0 ? totalGeneration : null,
    avgGenerationPerHour: hoursWithData > 0 ? totalGeneration / hoursWithData : null,
    avgPrice: null,
    priceRange: null,
    confidence,
    warnings,
    errors,
    timestamp: new Date().toISOString(),
  };
}

export function validatePricingData(
  data: LMPDataPoint[]
): DataQualityReport {
  const totalHours = 24;
  const hoursMissing: number[] = [];
  const hoursWithIssues: number[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  
  const hourMap = new Map<number, LMPDataPoint>();
  data.forEach(point => {
    const hourMatch = point.time.match(/T(\d{2})/);
    if (hourMatch) {
      hourMap.set(parseInt(hourMatch[1], 10), point);
    }
  });
  
  const prices: number[] = [];
  
  for (let hour = 0; hour < totalHours; hour++) {
    const point = hourMap.get(hour);
    
    if (!point) {
      hoursMissing.push(hour);
      warnings.push(`Missing pricing data for hour ${hour}:00`);
      continue;
    }
    
    prices.push(point.lmp);
    
    // Flag extreme prices
    if (point.lmp < -100) {
      hoursWithIssues.push(hour);
      warnings.push(`Large negative price at hour ${hour}:00 ($${point.lmp.toFixed(2)}/MWh)`);
    }
    
    if (point.lmp > 1000) {
      hoursWithIssues.push(hour);
      warnings.push(`Very high price at hour ${hour}:00 ($${point.lmp.toFixed(2)}/MWh)`);
    }
  }
  
  const avgPrice = prices.length > 0 
    ? prices.reduce((a, b) => a + b, 0) / prices.length 
    : null;
  
  const priceRange: [number, number] | null = prices.length > 0
    ? [Math.min(...prices), Math.max(...prices)]
    : null;
  
  let confidence: DataQualityReport['confidence'];
  if (hoursMissing.length === 0) {
    confidence = 'high';
  } else if (hoursMissing.length <= 3) {
    confidence = 'medium';
  } else if (hoursMissing.length <= 8) {
    confidence = 'low';
  } else {
    confidence = 'critical';
  }
  
  return {
    hoursPresent: prices.length,
    totalHours,
    hoursMissing,
    hoursWithIssues,
    totalGeneration: null,
    avgGenerationPerHour: null,
    avgPrice,
    priceRange,
    confidence,
    warnings,
    errors,
    timestamp: new Date().toISOString(),
  };
}
```

---

### 5. Updated API Route

**File:** `src/app/api/energy/route.ts`

```typescript
import { NextResponse } from "next/server";
import { fetchEIAFuelMix } from "@/lib/data/eia/fuel";
import { fetchGridStatusPricing } from "@/lib/data/gridStatus/pricing";
import { validateFuelMixData, validatePricingData } from "@/lib/data/validation/validator";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const location = searchParams.get("location");
  const date = searchParams.get("date");
  const view = searchParams.get("view");
  const node = searchParams.get("node");

  if (!date) {
    return NextResponse.json({ error: "Date parameter is required" }, { status: 400 });
  }

  try {
    // Pricing view - Grid Status only
    if (view === "pricing") {
      if (!node || !location) {
        return NextResponse.json(
          { error: "Location and node parameters are required for pricing view" },
          { status: 400 }
        );
      }

      const pricingData = await fetchGridStatusPricing(location, node, date);
      
      if (!pricingData) {
        return NextResponse.json(
          { error: "Failed to fetch pricing data", details: "Check API configuration and retry" },
          { status: 500 }
        );
      }
      
      const quality = validatePricingData(pricingData);
      
      // Log quality issues
      if (quality.errors.length > 0) {
        console.error(`[API] Pricing data errors for ${location}/${node}:`, quality.errors);
      }
      
      return NextResponse.json({
        lmp: pricingData,
        quality,
        meta: {
          source: "grid-status",
          view: "pricing",
          location,
          node,
          date,
          fetchedAt: new Date().toISOString(),
        },
      });
    }

    // Fuel mix view - EIA only
    if (!location) {
      return NextResponse.json(
        { error: "Location parameter is required for fuel mix view" },
        { status: 400 }
      );
    }

    const fuelData = await fetchEIAFuelMix(location, date);
    
    if (!fuelData) {
      return NextResponse.json(
        { error: "Failed to fetch fuel mix data", details: "Check API configuration and retry" },
        { status: 500 }
      );
    }
    
    const quality = validateFuelMixData(fuelData, location);
    
    // Log quality issues
    if (quality.errors.length > 0) {
      console.error(`[API] Fuel mix data errors for ${location}:`, quality.errors);
    }
    if (quality.warnings.length > 0) {
      console.warn(`[API] Fuel mix data warnings for ${location}:`, quality.warnings);
    }
    
    // Optionally reject critically bad data
    if (quality.confidence === 'critical') {
      return NextResponse.json(
        { 
          error: "Data quality too low",
          quality,
          details: quality.errors.join('; ')
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      hourly: fuelData,
      quality,
      meta: {
        source: "eia",
        view: "fuel-mix",
        location,
        date,
        fetchedAt: new Date().toISOString(),
      }
    });
  } catch (err) {
    const error = err as Error;
    console.error("[API] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 }
    );
  }
}
```

---

## Implementation Checklist

### Phase 1: Core Infrastructure (Week 1)
- [ ] Create `requestQueue.ts` with timeout/retry logic
- [ ] Implement `eia/fuel.ts` with frequency=hourly
- [ ] Implement `gridStatus/pricing.ts` with proper aggregation
- [ ] Create `validation/validator.ts` with null vs zero handling
- [ ] Update API route to use new structure
- [ ] Add comprehensive logging

### Phase 2: Caching & Optimization (Week 2)
- [ ] Implement smart cache with quality-based TTL
- [ ] Add request deduplication
- [ ] Implement pagination for Grid Status
- [ ] Add metrics collection

### Phase 3: UI & Observability (Week 3)
- [ ] Update chart components to show quality warnings
- [ ] Add loading states with timeout indicators
- [ ] Create admin dashboard for monitoring
- [ ] Add error boundary components

---

## Key Improvements

| Issue | Old Approach | New Approach |
|-------|--------------|--------------|
| **Data Source** | Mixed EIA/Grid Status | EIA for fuel, Grid Status for pricing |
| **Granularity** | 5-min → aggregate | Request hourly directly (`frequency=hourly`) |
| **Zero-fill** | Always filled | Null for missing, 0 for zero generation |
| **Validation** | None | Comprehensive quality reports |
| **Timeout** | Browser default (varies) | 30s with exponential backoff retry |
| **Rate Limiting** | None | Request queue with 200-500ms intervals |
| **Error Handling** | Generic errors | Typed errors (timeout, rate_limit, network, etc.) |
| **Pagination** | Ignored | Planned (Grid Status pricing) |

---

## Expected Performance

### EIA Fuel Mix (hourly)
```
Request:   200-500ms (queue wait + fetch)
Data size: ~5 KB (24 hours × 8 fuel types)
Success:   98% (generous rate limits)
Quality:   High (complete BA coverage)
```

### Grid Status Pricing
```
Request:   500-1000ms (queue wait + fetch + aggregation)
Data size: ~8-15 KB (depends on sub-hourly vs hourly)
Success:   95% (rate limit aware)
Quality:   High (node-level accuracy)
```

### Overall
```
Parallel fetch: 1-2 seconds total
Cache hit:      <100ms
Quality:        95% high confidence
Errors:         <5% (mostly rate limits)
```

