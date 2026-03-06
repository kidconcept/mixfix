# MixFix API Data Sources

## Current Implementation

### EIA (U.S. Energy Information Administration)
**Endpoint:** `https://api.eia.gov/v2/electricity/rto/fuel-type-data/data/`
**Documentation:** https://www.eia.gov/opendata/

**Features:**
- Hourly generation data by fuel type
- 75 respondents (ISOs, utilities, regional aggregations)
- Historical data available
- Free API key required

**Key Respondents:**
- Major ISOs: NYIS, CISO, ERCO, ISNE, MISO, PJM, SWPP
- Regional: US48, CAL, TEX, FLA, etc.
- Utilities: TVA, FPL, LDWP, etc.

**Data Format:**
```json
{
  "period": "2024-03-01T12",
  "respondent": "NYIS",
  "fueltype": "NG",
  "type-name": "Natural Gas",
  "value": 7352.5  // MWh
}
```

**Implementation:** `src/lib/energyData.ts`

---

## Planned Integration

### Grid Status API
**Website:** https://www.gridstatus.io
**Documentation:** See [GRID_STATUS_API.md](./GRID_STATUS_API.md) for detailed API documentation

**Status:** ✅ **Fully integrated** - Primary data source for supported ISOs

**Features:**
- Real-time grid data (5-minute intervals)
- Historical data back to ~2018
- Direct ISO data feeds (NYISO, CAISO, ERCOT, ISONE, MISO, PJM, SPP)
- Pricing information available
- More granular than EIA (5-min vs hourly)

**Key Datasets:**
- `nyiso_fuel_mix` - 5-minute fuel mix data
- `caiso_fuel_mix`, `ercot_fuel_mix`, `pjm_fuel_mix`, etc.
- `eia_fuel_mix_hourly` - Also available via Grid Status

**Authentication:**
- API key required (configured in `.env.local` as `GRID_API_KEY`)
- Pass via `x-api-key` header

**API Endpoint:**
```bash
GET https://api.gridstatus.io/v1/datasets/{dataset_id}/query
  ?start_time=2024-03-01T00:00:00Z
  &end_time=2024-03-01T23:59:59Z
```

**Rate Limits:**
- TBD - to be monitored during usage

**Implementation:**
- ✅ Adapter created at `src/lib/gridStatusData.ts`
- ✅ Auto-selection in API route with EIA fallback
- ✅ Hourly aggregation from 5-minute data
- ✅ Data source indicator in UI
- ⬜ Test with all supported ISOs
- ⬜ Caching strategy

---

## Future Data Sources

### Electricity Maps
- Real-time carbon intensity data
- International coverage
- Commercial API available

### ISO-Specific APIs
- CAISO OASIS
- ERCOT API
- NYISO OASIS
- Direct access for more detailed data

---

## Data Aggregation Strategy

When multiple sources are available:
1. Prefer Grid Status for real-time data (if available)
2. Fall back to EIA for historical data
3. Consider data freshness and completeness
4. Implement source indicator in UI
