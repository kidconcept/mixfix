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

## Data sources (planned)

- [Electricity Maps API](https://api.electricitymap.org) — real-time grid carbon intensity & generation mix
- [EIA Open Data](https://api.eia.gov) — US grid data
- [ENTSO-E Transparency Platform](https://transparency.entsoe.eu) — European grid
- [Ember Climate](https://ember-climate.org/data/) — global historical generation data
- Private sources TBD

All data integration goes in `src/app/api/energy/route.ts` and `src/lib/energyData.ts`.

---

## Roadmap

- [ ] Wire up first live data source (Electricity Maps)
- [ ] Add region selector (Global / Europe / US / Asia)
- [ ] Persist historical data to a database (Postgres / Supabase)
- [ ] Carbon intensity overlay
- [ ] Alerts for grid events (high fossil, duck curve, etc.)
