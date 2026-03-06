# Grid Status API Documentation

## Overview

Grid Status provides real-time and historical electricity grid data from ISOs across North America.

**Base URL:** `https://api.gridstatus.io/v1`  
**Authentication:** API Key via `x-api-key` header  
**Documentation:** https://www.gridstatus.io

## Authentication

```bash
curl -H "x-api-key: YOUR_API_KEY" "https://api.gridstatus.io/v1/datasets"
```

Environment variable: `GRID_API_KEY`

## Available Fuel Mix Datasets

Grid Status has fuel mix data for all major US ISOs:

| Dataset ID | ISO | Frequency | Earliest Data |
|------------|-----|-----------|---------------|
| `nyiso_fuel_mix` | NYISO | 5 minutes | 2018-01-01 |
| `caiso_fuel_mix` | CAISO | varies | varies |
| `ercot_fuel_mix` | ERCOT | varies | varies |
| `isone_fuel_mix` | ISO-NE | varies | varies |
| `miso_fuel_mix` | MISO | varies | varies |
| `pjm_fuel_mix` | PJM | varies | varies |
| `spp_fuel_mix` | SPP | varies | varies |
| `eia_fuel_mix_hourly` | EIA (all) | 1 hour | varies |

Also available:
- `aeso_fuel_mix` (Alberta)
- `ieso_fuel_mix` (Ontario)

## Listing Available Datasets

```bash
GET /v1/datasets
```

Response includes metadata for all datasets:
- `id` - dataset identifier
- `name` - human-readable name
- `description` - detailed description
- `earliest_available_time_utc` - oldest available data
- `latest_available_time_utc` - newest available data
- `data_frequency` - update frequency (5_MINUTES, 1_HOUR, etc.)
- `all_columns` - column definitions with types

## Querying Data

### Endpoint Pattern

```bash
GET /v1/datasets/{dataset_id}/query
```

### Query Parameters

- `start_time` (required) - ISO 8601 timestamp (e.g., `2024-03-01T00:00:00Z`)
- `end_time` (required) - ISO 8601 timestamp
- `limit` (optional) - max rows to return (default: 50000)
- `page` (optional) - page number for pagination

### Example: NYISO Fuel Mix

**Request:**
```bash
curl -H "x-api-key: YOUR_KEY" \
  "https://api.gridstatus.io/v1/datasets/nyiso_fuel_mix/query?start_time=2024-03-01T00:00:00Z&end_time=2024-03-01T01:00:00Z"
```

**Response:**
```json
{
  "status_code": 200,
  "data": [
    {
      "interval_start_utc": "2024-03-01T00:00:00+00:00",
      "interval_end_utc": "2024-03-01T00:05:00+00:00",
      "dual_fuel": 5181.0,
      "hydro": 4146.0,
      "natural_gas": 3849.0,
      "nuclear": 3276.0,
      "other_fossil_fuels": 0.0,
      "other_renewables": 230.0,
      "wind": 1528.0
    }
  ],
  "meta": {
    "page": 1,
    "limit": null,
    "page_size": 50000,
    "hasNextPage": false
  }
}
```

## NYISO-Specific Data Notes

### Fuel Categories

NYISO has a unique "Dual Fuel" category:

- `dual_fuel` - Units that can run on either natural gas or fuel oil (usually gas)
- `natural_gas` - Natural gas-only units
- `hydro` - Hydroelectric
- `nuclear` - Nuclear
- `other_fossil_fuels` - Coal, oil, etc.
- `other_renewables` - Solar, biofuels, etc.
- `wind` - Wind

### Data Frequency

NYISO fuel mix is resampled to **5-minute intervals**. For hourly aggregation:
- Take data points at the top of each hour, or
- Average/sum the 12 data points per hour

### Values

All generation values are in **MW (megawatts)**, not MWh.

## Comparison: Grid Status vs EIA

| Feature | Grid Status | EIA |
|---------|-------------|-----|
| Frequency | 5 min - 1 hour | 1 hour |
| Latency | Near real-time | ~1 day delay |
| Historical | Back to ~2018 | Back to 2015 |
| Fuel detail | ISO-specific | Standardized |
| Coverage | Major ISOs | 75+ respondents |
| Rate limits | TBD | None known |

**Key Differences:**

1. **NYISO Dual Fuel:** Grid Status keeps dual fuel separate; EIA may combine with gas
2. **Solar:** EIA (COL/NG/SUN/etc) vs Grid Status (other_renewables may include solar)
3. **Granularity:** Grid Status 5-min data allows for better peak/valley analysis
4. **Freshness:** Grid Status better for real-time visualization

## Implementation Strategy

### Mapping Grid Status → Our Types

Our existing `EnergySource` types:
```typescript
"solar" | "wind" | "hydro" | "nuclear" | "gas" | "coal" | "oil" | "other"
```

NYISO Grid Status mapping:
```typescript
{
  gas: natural_gas + dual_fuel,  // Combine dual fuel with gas
  hydro: hydro,
  nuclear: nuclear,
  wind: wind,
  coal: 0,  // Not present in NYISO
  oil: other_fossil_fuels,
  solar: 0,  // Included in other_renewables
  other: other_renewables
}
```

### Hourly Aggregation

For hourly display, sample at the top of each hour (HH:00:00) or average 12 five-minute intervals.

### Fallback Logic

1. Try Grid Status for requested date/ISO
2. If unavailable or error, fall back to EIA
3. Cache responses to minimize API calls
4. Display data source in UI

## Rate Limits

**Status:** To be determined through testing

Monitor response headers for rate limit information:
- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`

## Error Handling

```json
{
  "status_code": 400,
  "detail": "Error message"
}
```

Common errors:
- 400: Invalid parameters
- 401: Invalid API key
- 404: Dataset not found
- 429: Rate limit exceeded

## Implementation Status

1. ✅ Explore API structure and datasets
2. ✅ Create `src/lib/gridStatusData.ts` adapter
3. ✅ Implement NYISO fuel mix fetching
4. ✅ Add hourly aggregation logic
5. ⬜ Test with other ISOs (CAISO, ERCOT, PJM)
6. ✅ Add fallback to EIA
7. ✅ Display data source indicator in UI
8. ⬜ Implement caching strategy

## Usage

The API automatically selects Grid Status for supported ISOs and falls back to EIA:

```bash
# Auto-select (prefers Grid Status)
GET /api/energy?location=NYISO&date=2024-03-01

# Force Grid Status
GET /api/energy?location=NYISO&date=2024-03-01&source=grid-status

# Force EIA
GET /api/energy?location=NYISO&date=2024-03-01&source=eia
```

Response includes source metadata:
```json
{
  "hourly": [...],
  "meta": {
    "source": "grid-status",
    "location": "NYISO",
    "date": "2024-03-01"
  }
}
```
