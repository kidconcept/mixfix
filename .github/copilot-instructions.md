# MixFix — Copilot Instructions

## Project purpose
A Next.js webapp tracking and visualizing the global electricity generation mix from public and private energy data sources.

## Stack
- Next.js 15 App Router + Turbopack
- TypeScript (strict)
- Tailwind CSS
- Recharts for charts
- SWR for data fetching

## Conventions
- All data types live in `src/types/energy.ts`
- Data fetching/transformation logic lives in `src/lib/energyData.ts`
- The API route at `src/app/api/energy/route.ts` is the single backend entry point
- Components are client components where interactivity is needed (`"use client"`)
- **All colors must use CSS custom property theme variables** (e.g., `var(--text-primary)`, `var(--active)`, etc.) — never use hardcoded color values
- Dark background: `--background: #0a0f1a`; use `bg-white/5` for card surfaces

## Data integration
Replace mock functions in `src/lib/energyData.ts` with real API calls.
Planned sources: Electricity Maps, EIA, ENTSO-E, Ember Climate.
Store credentials in `.env.local` (never commit).
