# MixFix BA Expansion Plan

**Goal**: Expand from 7 hardcoded ISOs to all 75 EIA Balancing Authorities with zone-level pricing for ISOs.

**Status**: Phase 1 Complete ✅ | Phase 2 Ready to Start  
**Started**: March 7, 2026  
**Phase 1 Completed**: March 8, 2026

---

## Overview

Support **all 75 Balancing Authorities** for fuel mix data while providing **zone-level pricing** for the 7 ISOs with wholesale markets.

### Coverage

- **All 75 BAs**: Fuel mix data from EIA API
  - 7 ISOs: NYISO, CAISO, PJM, MISO, ERCOT, ISONE, SPP
  - 68 Others: TVA, FPL, LDWP, BPA, WAPA, municipal utilities, regional aggregations
  - **US Coverage**: ~95-100% of electricity consumption

- **7 ISOs Only**: Fuel mix + zone-level pricing from Grid Status API
  - **Pricing Granularity**: Zone-level (~8-20 zones per ISO, not thousands of nodes)
  - **US Coverage**: ~60-65% of electricity, 60-70% of population

---

## Implementation Phases

### Phase 1: Configuration Infrastructure ✅ COMPLETE

**Timeline**: March 7-8, 2026

**Tasks:**
- [x] Create plan document
- [x] Create `scripts/fetch-eia-respondents.ts` to query EIA API
- [x] Run script to generate `config/balancing-authorities.json` with all 75 BAs
- [x] Query Grid Status for zone lists (7 ISOs) - hybrid API + manual approach
- [x] Populate zone data in config file
- [x] Create populate-zones script for zone data management

**Deliverables:**
- ✅ `config/balancing-authorities.json` - Complete BA configuration (75 BAs, 71 zones)
- ✅ `scripts/fetch-eia-respondents.ts` - Automated BA discovery
- ✅ `scripts/fetch-grid-status-zones.ts` - API-based zone fetching (ISO-specific filters)
- ✅ `scripts/populate-zones.ts` - Hybrid manual + API-fetched zone population

**Results:**
- **Total BAs**: 75 (7 ISOs with pricing, 68 without)
- **Total Zones**: 71 across 7 ISOs
  - CAISO: 3 trading hubs
  - ERCOT: 8 load zones
  - ISONE: 8 zones
  - MISO: 7 hubs
  - NYISO: 15 zones
  - PJM: 19 zones
  - SPP: 3 hubs

---

### Phase 2: Update Backend ⏳ NEXT

**Tasks:**
- [ ] Refactor `src/lib/data/eia/fuel.ts` to load BAs from config
- [ ] Update `src/lib/data/gridStatus/pricing.ts` to load zones from config
- [ ] Modify `fetchGridStatusPricing()` to filter by `location_type='Zone'`
- [ ] Add `isPricingAvailable(ba)` helper function
- [ ] Update API route to conditionally fetch pricing based on `hasPricing` flag
- [ ] Add config loader utility

**Deliverables:**
- Config-driven backend
- Conditional pricing queries
- Helper functions for BA/zone validation

**Timeline**: 2-3 days

---

### Phase 3: Update Frontend

**Tasks:**
- [ ] Modify chart to handle pricing absence gracefully
- [ ] Add UI indicator: "Pricing data available for ISOs only" for non-ISO BAs
- [ ] Update geocode to return zone names (not nodes) for ISOs
- [ ] Rename "Node" field to "Zone" in UI
- [ ] Add BA autocomplete/dropdown with all 75 options
- [ ] Update error messages for non-ISO entities

**Deliverables:**
- Updated UI with zone terminology
- BA selector with autocomplete
- Graceful handling of missing pricing data

**Timeline**: 2-3 days

---

### Phase 4: Address-Based Zone Selection

**Tasks:**
- [ ] Manually curate zone boundaries for 7 ISOs (lat/lon rectangles)
- [ ] Store boundaries in `config/zone-boundaries.json`
- [ ] Update `/api/geocode` to map coordinates → zone for all 7 ISOs
- [ ] Implement fallback to `representativeZone` if no match
- [ ] Test coverage for all US regions

**Deliverables:**
- `config/zone-boundaries.json` - Zone boundary definitions
- Enhanced geocode API with zone detection

**Timeline**: 3-5 days

---

### Phase 5: Monitoring & Updates

**Tasks:**
- [ ] Create weekly automated script to check for new BAs/zones
- [ ] Add alerting for config drift (new respondents, missing zones)
- [ ] Document manual review process
- [ ] Add CI/CD integration for config validation

**Deliverables:**
- Automated monitoring script
- Documentation for config maintenance

**Timeline**: 1-2 days

---

## Configuration Schema

### Balancing Authority Config

```json
{
  "NYISO": {
    "code": "NYISO",
    "eiaCode": "NYIS",
    "name": "New York Independent System Operator",
    "type": "ISO",
    "timezone": "America/New_York",
    "hasPricing": true,
    "gridStatusDataset": "nyiso_lmp_real_time_hourly",
    "zones": [
      "CAPITL", "CENTRL", "DUNWOD", "GENESE", 
      "HUD_VL", "LONGIL", "MHK_VL", "MILLWD", 
      "N.Y.C.", "NORTH", "WEST"
    ],
    "representativeZone": "CENTRL"
  },
  "TVA": {
    "code": "TVA",
    "eiaCode": "TVA",
    "name": "Tennessee Valley Authority",
    "type": "Utility",
    "timezone": "America/Chicago",
    "hasPricing": false
  }
}
```

### Zone Boundary Config

```json
{
  "NYISO": {
    "CAPITL": {
      "name": "Capital",
      "bounds": {
        "north": 43.5,
        "south": 42.0,
        "east": -73.0,
        "west": -74.5
      }
    }
  }
}
```

---

## Key Benefits

✅ **Near-complete US coverage** — All 75 BAs = 95-100% of US electricity  
✅ **Simpler than node-level** — 8-20 zones per ISO vs 1000s of nodes  
✅ **Clean data model** — Zone pricing aligns with how ISOs publish load zone prices  
✅ **Honest UX** — Clear messaging when pricing unavailable (non-ISO entities)  
✅ **Maintainable** — Zones change rarely (annually at most), nodes change monthly  
✅ **Lower bandwidth** — Fewer API queries, smaller dataset sizes

---

## Trade-offs Accepted

❌ **No pricing for 68 entities** — Utilities/regional aggregations don't have wholesale markets  
❌ **Zone-level not node-level** — Less granular than individual nodes, but still locational  
✅ **Acceptable** — Zone-level pricing is how ISOs publish reference prices and what retail utilities use for settlements

---

## Timeline Estimate

- **Phase 1** (Config): 2-3 days ⏳ IN PROGRESS
- **Phase 2** (Backend): 2-3 days
- **Phase 3** (Frontend): 2-3 days
- **Phase 4** (Geo-zones): 3-5 days
- **Phase 5** (Monitoring): 1-2 days

**Total**: 10-16 days (~2-3 weeks)

---

## Notes

- EIA API updated 2024-2025 - verify all 75 respondents still active
- Grid Status zone lists verified as of March 2026
- Zone boundaries approximate - use representative zone for edge cases
- Weekly validation recommended for production deployment
