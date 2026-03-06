# MixFix

**Track and visualize the global electricity generation mix.**

MixFix is a Next.js webapp for monitoring the global energy grid — pulling generation data from public and private sources, storing it, and presenting it through interactive charts and dashboards.

---

## Stack

| Layer | Tool |
|---|---|
| Framework | Next.js 15 (App Router, Turbopack) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Charts | Recharts |
| Data fetching | SWR |
| Runtime | Node.js |

---

## Getting started

```bash
npm install
npm run dev       # http://localhost:3000
npm run build     # production build
npm run lint      # ESLint
```

### Environment Variables

Copy `.env.local.example` to `.env.local` and add your API keys:

```bash
cp .env.local.example .env.local
```

Required keys:
- `EIA_API_KEY` - Get a free key at https://www.eia.gov/opendata/register.php
- `GRID_API_KEY` - Get a key at https://www.gridstatus.io

---

## Project structure

```
src/
  app/
    page.tsx              # Home dashboard
    layout.tsx            # Root layout
    globals.css           # Base styles
    api/
      energy/route.ts     # /api/energy endpoint (swap in real data here)
  components/
    EnergyDashboard.tsx   # Main dashboard shell
    MixPieChart.tsx       # Donut chart for current mix
    TrendLineChart.tsx    # 12-month renewable/fossil/nuclear trend
    SourceCard.tsx        # Per-source summary card
  lib/
    energyData.ts         # Data helpers + placeholder mock data
  types/
    energy.ts             # Shared TypeScript types
```

---

## Data sources

**Currently integrated:**
- ✅ [Grid Status API](https://www.gridstatus.io) — Real-time ISO data (primary source)
  - 5-minute granularity for major ISOs
  - NYISO, CAISO, ERCOT, ISONE, MISO, PJM, SPP
  - Auto-fallback to EIA if unavailable
- ✅ [EIA Open Data](https://api.eia.gov) — US grid hourly generation data (fallback)
  - 75 respondents including utilities and regional aggregations
  - Historical data back to 2015

**Planned:**
- [ ] [Electricity Maps API](https://api.electricitymap.org) — real-time grid carbon intensity & generation mix
- [ ] [ENTSO-E Transparency Platform](https://transparency.entsoe.eu) — European grid
- [ ] [Ember Climate](https://ember-climate.org/data/) — global historical generation data

See [docs/API_SOURCES.md](docs/API_SOURCES.md) for detailed integration notes.

---

## Roadmap

- [ ] Wire up first live data source (Electricity Maps)
- [ ] Add region selector (Global / Europe / US / Asia)
- [ ] Persist historical data to a database (Postgres / Supabase)
- [ ] Carbon intensity overlay
- [ ] Alerts for grid events (high fossil, duck curve, etc.)
