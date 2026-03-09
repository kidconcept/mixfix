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

## Deployment (Vercel)

Recommended path: connect this repo to Vercel for automatic production and preview deploys.

### 1. Preflight

```bash
npm install
npm run build
```

Make sure these environment variables are available in Vercel:
- `EIA_API_KEY`
- `GRID_API_KEY`

### 2. Create the Vercel project

1. Push this repo to GitHub.
2. Go to Vercel and import the repository.
3. Keep default Next.js settings.
4. Set `main` as the production branch.

### 3. Add environment variables

In Vercel project settings, add each variable for:
- `Production`
- `Preview`

Then redeploy.

### 4. Smoke test deployed app

Use your deployed URL and verify:

```bash
curl -s "https://<your-domain>/api/geocode?address=New+York+City"
curl -s "https://<your-domain>/api/energy?location=FPL&date=2026-03-06"
curl -s "https://<your-domain>/api/energy?location=NYISO&date=2026-03-06&view=pricing&node=N.Y.C."
```

Notes:
- Pricing calls can return `429` when Grid Status quota is exceeded.
- The app handles this and can fall back to mock pricing mode in UI.

### 5. Custom domain

1. Add your domain in Vercel project settings.
2. Apply the DNS records shown by Vercel at your domain registrar.
3. Wait for DNS propagation and HTTPS certificate issuance.
4. Confirm your custom domain is set as production.

### 6. Preview workflow

With GitHub connected, each pull request gets a preview deployment URL automatically.
Use preview deployments to validate UI/data changes before merging to `main`.

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
