"use client";

import { useState } from "react";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  TooltipProps,
} from "recharts";
import { HistoricalRecord, LMPDataPoint, Granularity } from "@/types/energy";
import { getTimezoneAbbreviation } from "@/lib/timezone";

interface CombinedChartProps {
  fuelMixData: HistoricalRecord[]; // Secondary/enhancement data (optional)
  pricingData: LMPDataPoint[]; // Primary data (required for chart display)
  balancingAuthority?: string; // ISO/RTO identifier for timezone display
  baName?: string; // BA name for Y-axis label
  zoneName?: string; // Zone name for Y-axis label
  granularity?: Granularity; // daily (default), monthly, or yearly
}

type DataKey = 'solar' | 'wind' | 'hydro' | 'geothermal' | 'biomass' | 'batteries' | 'imports' | 'other' | 'coal' | 'gas' | 'oil' | 'nuclear' | 'charging' | 'lmp' | 'spp' | 'energy' | 'congestion' | 'loss';

// Map data keys to CSS variable names
const COLOR_VARS: Record<DataKey, string> = {
  // Fuel mix
  solar: 'var(--fuel-solar)',
  wind: 'var(--fuel-wind)',
  hydro: 'var(--fuel-hydro)',
  geothermal: 'var(--fuel-geothermal)',
  biomass: 'var(--fuel-biomass)',
  batteries: 'var(--fuel-batteries)',
  imports: 'var(--fuel-imports)',
  other: 'var(--fuel-other)',
  coal: 'var(--fuel-coal)',
  gas: 'var(--fuel-gas)',
  oil: 'var(--fuel-oil)',
  nuclear: 'var(--fuel-nuclear)',
  charging: 'var(--fuel-charging)',
  // Pricing
  lmp: 'var(--price-lmp)',
  spp: 'var(--price-spp)',
  energy: 'var(--price-energy)',
  congestion: 'var(--price-congestion)',
  loss: 'var(--price-loss)',
};

interface LegendGroup {
  name: string;
  items: DataKey[];
}

const LEGEND_GROUPS: LegendGroup[] = [
  {
    name: "Pricing",
    items: ['lmp', 'spp', 'energy', 'congestion', 'loss']
  },
  {
    name: "Renewables",
    items: ['solar', 'wind', 'hydro', 'geothermal', 'biomass', 'batteries', 'imports', 'other']
  },
  {
    name: "Consumables",
    items: ['coal', 'gas', 'oil', 'nuclear']
  },
  {
    name: "Storage Load",
    items: ['charging']
  }
];

const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Custom Tooltip Component
const CustomTooltip = ({ 
  active, 
  payload, 
  label,
  keysWithData,
  granularity,
}: TooltipProps<any, any> & { keysWithData: Set<DataKey>; granularity: Granularity }) => {
  if (!active || !payload || !payload.length) return null;

  // Filter payload to only show items with data across the time range
  const filteredPayload = payload.filter(item => {
    const dataKey = item.dataKey as DataKey;
    return keysWithData.has(dataKey);
  });

  if (filteredPayload.length === 0) return null;

  // Sort to match LEGEND_GROUPS order
  const sortOrder: DataKey[] = [
    'lmp', 'spp', 'energy', 'congestion', 'loss',
    'solar', 'wind', 'hydro', 'geothermal', 'biomass', 'batteries', 'imports', 'other',
    'coal', 'gas', 'oil', 'nuclear',
    'charging'
  ];
  const sortedPayload = [...filteredPayload].sort((a, b) => {
    const aIndex = sortOrder.indexOf(a.dataKey as DataKey);
    const bIndex = sortOrder.indexOf(b.dataKey as DataKey);
    return aIndex - bIndex;
  });

  return (
    <div 
      style={{
        backgroundColor: "var(--bg-secondary)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "8px",
        boxShadow: "0 4px 6px var(--shadow-subtle)",
        fontFamily: "Inter, sans-serif",
        padding: "8px 12px",
      }}
    >
      <div style={{ color: "var(--text-primary)", fontWeight: 600, marginBottom: "4px" }}>
        {granularity === 'yearly'
          ? MONTH_NAMES[label as number] || `Month ${label}`
          : granularity === 'monthly'
            ? `Day ${label}`
            : label === 24 ? 'Hour 0:00 (next day)' : `Hour ${label}:00`}
      </div>
      {sortedPayload.map((item, index) => {
        const dataKey = String(item.dataKey || '');
        const isPricing = ["lmp", "spp", "energy", "congestion", "loss"].includes(dataKey.toLowerCase());
        const displayName = dataKey ? 
          (isPricing ? dataKey.toUpperCase() : 
           dataKey === 'charging' ? 'Charging' :
           dataKey.charAt(0).toUpperCase() + dataKey.slice(1))
          : item.name;
        const formattedValue = isPricing 
          ? `$${Number(item.value).toFixed(2)}/MWh`
          : `${Number(item.value).toFixed(2)} GW`;
        
        return (
          <div key={index} style={{ 
            color: "var(--text-primary)", 
            fontSize: "var(--font-sm)",
            display: "flex",
            alignItems: "center",
            gap: "6px"
          }}>
            <span style={{ 
              width: "12px", 
              height: "12px", 
              backgroundColor: item.color,
              borderRadius: "2px",
              flexShrink: 0
            }} />
            <span>{displayName}: {formattedValue}</span>
          </div>
        );
      })}
    </div>
  );
};

export default function CombinedChart({ fuelMixData, pricingData, balancingAuthority, baName, zoneName, granularity = 'daily' }: CombinedChartProps) {
  // Track visibility state for each data series
  const [visibility, setVisibility] = useState<Record<DataKey, boolean>>({
    // Renewables (8)
    solar: true,
    wind: true,
    hydro: true,
    geothermal: true,
    biomass: true,
    batteries: true,
    imports: true,
    other: true,
    // Consumables (4)
    coal: true,
    gas: true,
    oil: true,
    nuclear: true,
    // Charging
    charging: true,
    // Pricing (5)
    lmp: true,
    spp: true,
    energy: true,
    congestion: true,
    loss: true,
  });

  const toggleItem = (key: DataKey) => {
    // Show only the clicked item, hide everything else
    const newState: Record<DataKey, boolean> = {
      // Renewables (8)
      solar: false,
      wind: false,
      hydro: false,
      geothermal: false,
      biomass: false,
      batteries: false,
      imports: false,
      other: false,
      // Consumables (4)
      coal: false,
      gas: false,
      oil: false,
      nuclear: false,
      // Charging
      charging: false,
      // Pricing (5)
      lmp: false,
      spp: false,
      energy: false,
      congestion: false,
      loss: false,
    };
    newState[key] = true;
    setVisibility(newState);
  };

  const toggleGroup = (group: LegendGroup) => {
    const allVisible = group.items.every(item => visibility[item]);
    const newState = { ...visibility };
    group.items.forEach(item => {
      newState[item] = !allVisible;
    });
    setVisibility(newState);
  };
  if ((!fuelMixData || fuelMixData.length === 0) && (!pricingData || pricingData.length === 0)) {
    return (
      <div className="text-center py-8" style={{ color: 'var(--text-secondary)' }}>
        No data available for the selected period.
      </div>
    );
  }

  const hasPricingData = pricingData && pricingData.length > 0;

  // Helper to safely get numeric value (data is already in GW from API)
  const toNumber = (val: number | string | undefined): number => {
    if (val === undefined) return 0;
    const num = typeof val === 'string' ? parseFloat(val) : val;
    return isNaN(num) ? 0 : num;
  };

  // Extract fuel values from a record, with optional charging split (daily only)
  const extractFuels = (fuelData: HistoricalRecord | undefined, splitCharging: boolean) => {
    if (!fuelData) {
      return {
        solar: 0, wind: 0, hydro: 0, geothermal: 0, biomass: 0, batteries: 0,
        imports: 0, other: 0, nuclear: 0, gas: 0, coal: 0, oil: 0, charging: 0,
      };
    }
    const raw = {
      solar: toNumber(fuelData.solar), wind: toNumber(fuelData.wind),
      hydro: toNumber(fuelData.hydro), geothermal: toNumber(fuelData.geothermal),
      biomass: toNumber(fuelData.biomass), batteries: toNumber(fuelData.batteries),
      imports: toNumber(fuelData.imports), other: toNumber(fuelData.other),
      nuclear: toNumber(fuelData.nuclear), gas: toNumber(fuelData.gas),
      coal: toNumber(fuelData.coal), oil: toNumber(fuelData.oil),
    };
    if (!splitCharging) return { ...raw, charging: 0 };
    let chargingTotal = 0;
    const result: Record<string, number> = { charging: 0 };
    for (const [k, v] of Object.entries(raw)) {
      if (v < 0) { chargingTotal += Math.abs(v); result[k] = 0; }
      else { result[k] = v; }
    }
    result.charging = chargingTotal;
    return result;
  };

  // Build pricing fields from an LMPDataPoint
  const extractPricing = (priceData: LMPDataPoint | undefined) => ({
    lmp: priceData?.lmp != null ? Number(priceData.lmp.toFixed(2)) : null,
    spp: priceData?.spp != null ? Number(priceData.spp.toFixed(2)) : null,
    energy: priceData?.energy != null ? Number(priceData.energy.toFixed(2)) : null,
    congestion: priceData?.congestion != null ? Number(priceData.congestion.toFixed(2)) : null,
    loss: priceData?.loss != null ? Number(priceData.loss.toFixed(2)) : null,
  });

  // ---- X-axis label ----
  let xAxisLabel = '';
  let xAxisDataKey: string;

  if (granularity === 'daily') {
    xAxisDataKey = 'hour';
    // Extract and format the date from the data
    const dateStr = pricingData?.[0]?.time || fuelMixData?.[0]?.date;
    if (dateStr) {
      const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        const d = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
        const month = d.toLocaleDateString('en-US', { month: 'long' });
        const day = d.getDate();
        const tz = balancingAuthority ? getTimezoneAbbreviation(balancingAuthority) : "";
        xAxisLabel = tz ? `Hours (${month} ${day}, ${tz})` : `Hours (${month} ${day})`;
      }
    }
  } else if (granularity === 'monthly') {
    xAxisDataKey = 'period';
    const dateStr = fuelMixData?.[0]?.date;
    if (dateStr) {
      const match = dateStr.match(/^(\d{4})-(\d{2})/);
      if (match) {
        const d = new Date(parseInt(match[1]), parseInt(match[2]) - 1, 1);
        const month = d.toLocaleDateString('en-US', { month: 'long' });
        xAxisLabel = `Days (${month} ${match[1]})`;
      }
    }
  } else {
    xAxisDataKey = 'period';
    const dateStr = fuelMixData?.[0]?.date;
    if (dateStr) {
      const match = dateStr.match(/^(\d{4})/);
      if (match) xAxisLabel = `Months (${match[1]})`;
    }
  }

  // ---- Build combined data ----
  let combinedData: Record<string, any>[];

  if (granularity === 'daily') {
    // Existing hour-keyed logic (0–24 array)
    const fuelByHour: Record<number, HistoricalRecord> = {};
    if (fuelMixData && fuelMixData.length > 0) {
      fuelMixData.forEach(item => {
        const dateStr = typeof item.date === 'string' ? item.date : '';
        const hourMatch = dateStr.match(/T(\d{2})/);
        const hour = hourMatch ? parseInt(hourMatch[1], 10) : 0;
        if (hour >= 0 && hour <= 24) fuelByHour[hour] = item;
      });
    }
    const pricingByHour: Record<number, LMPDataPoint> = {};
    if (pricingData && pricingData.length > 0) {
      pricingData.forEach(point => {
        const hourMatch = point.time.match(/T(\d{2})/);
        const hour = hourMatch ? parseInt(hourMatch[1], 10) : 0;
        if (hour >= 0 && hour <= 24) pricingByHour[hour] = point;
      });
    }
    combinedData = Array.from({ length: 25 }, (_, hour) => ({
      hour,
      ...extractFuels(fuelByHour[hour], true),
      ...extractPricing(pricingByHour[hour]),
    }));

  } else if (granularity === 'monthly') {
    // Day-keyed: period = day number (1–31)
    const pricingByDay: Record<number, LMPDataPoint> = {};
    if (pricingData && pricingData.length > 0) {
      pricingData.forEach(point => {
        const day = parseInt(point.time.split('-')[2], 10);
        if (day >= 1 && day <= 31) pricingByDay[day] = point;
      });
    }
    combinedData = fuelMixData.map(item => {
      const day = parseInt(item.date.split('-')[2], 10);
      return {
        period: day,
        ...extractFuels(item, false),
        ...extractPricing(pricingByDay[day]),
      };
    });

  } else {
    // Yearly: period = month number (1–12)
    const pricingByMonth: Record<number, LMPDataPoint> = {};
    if (pricingData && pricingData.length > 0) {
      pricingData.forEach(point => {
        const month = parseInt(point.time.split('-')[1], 10);
        if (month >= 1 && month <= 12) pricingByMonth[month] = point;
      });
    }
    combinedData = fuelMixData.map(item => {
      const month = parseInt(item.date.split('-')[1], 10);
      return {
        period: month,
        ...extractFuels(item, false),
        ...extractPricing(pricingByMonth[month]),
      };
    });
  }

  // Determine which data keys have actual content (non-zero values)
  const hasDataForKey = (key: DataKey): boolean => {
    return combinedData.some(point => {
      const value = point[key];
      return value !== null && value !== undefined && value !== 0;
    });
  };

  // Create a Set of keys that have data for filtering tooltip
  const keysWithData = new Set<DataKey>(
    ['solar', 'wind', 'hydro', 'geothermal', 'biomass', 'batteries', 'imports', 'other', 
     'coal', 'gas', 'oil', 'nuclear', 'charging', 'lmp', 'spp', 'energy', 'congestion', 'loss']
      .filter(key => hasDataForKey(key as DataKey)) as DataKey[]
  );

  return (
    <div className="rounded-lg" style={{ background: 'transparent' }}>
      {/* Chart and Legend Side-by-Side */}
      <div className="flex flex-col landscape:flex-row landscape:gap-6 gap-2">
        {/* Chart */}
        <div className="flex-1 chart-plot-area" style={{ height: '55vh', minHeight: '400px', maxHeight: '80vh' }}>
          <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={combinedData}
          margin={{
            top: 0,
            right: 0,
            left: 0,
            bottom: 25,
          }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-lighter)" />
          
          <XAxis 
            dataKey={xAxisDataKey}
            stroke="var(--text-primary)"
            label={{ 
              value: xAxisLabel, 
              position: "insideBottom", 
              offset: -10, 
              fill: "var(--text-primary)", 
              fontWeight: 400,
              fontSize: "var(--font-sm)"
            }}
            tick={{ fill: "var(--text-primary)", fontSize: "var(--font-xs)" }}
            height={40}
            {...(granularity === 'yearly' ? { tickFormatter: (v: number) => MONTH_NAMES[v] || '' } : {})}
          />
          
          {/* Left Y-axis for Generation */}
          <YAxis 
            yAxisId="generation"
            stroke="var(--text-primary)"
            tick={{ fill: "var(--text-primary)", fontSize: "var(--font-xs)" }}
            width={40}
            label={{ 
              value: "Generation in GW", 
              angle: -90, 
              position: "insideLeft",
              offset: 8,
              fill: "var(--text-primary)", 
              fontWeight: 400,
              fontSize: "var(--font-sm)",
              style: { textAnchor: 'middle' }
            }}
          />
          
          {/* Right Y-axis for Price */}
          <YAxis 
            yAxisId="price"
            orientation="right"
            stroke="var(--text-primary)"
            tick={{ fill: "var(--text-primary)", fontSize: "var(--font-xs)" }}
            width={hasPricingData ? 40 : 0}
            hide={!hasPricingData}
            label={hasPricingData ? { 
              value: "Price in $/MWh",
              angle: 90, 
              position: "insideRight",
              fill: "var(--text-primary)", 
              fontWeight: 400,
              fontSize: "var(--font-sm)",
              style: { textAnchor: 'middle' }
            } : undefined}
          />
          
          <Tooltip content={<CustomTooltip keysWithData={keysWithData} granularity={granularity} />} />
          
          {/* Stacked areas for fuel mix (right Y-axis) */}
          {/* Render in REVERSE of tooltip order so visual top-to-bottom matches tooltip top-to-bottom */}
          
          {/* Consumables in reverse (Nuclear first = visual bottom, Coal last = visual top of consumables) */}
          <Area
            yAxisId="generation"
            type="monotone"
            dataKey="nuclear"
            stackId="1"
            stroke="var(--fuel-nuclear)"
            fill="var(--fuel-nuclear)"
            fillOpacity={0.95}
            name="Nuclear"
            hide={!visibility.nuclear}
          />
          <Area
            yAxisId="generation"
            type="monotone"
            dataKey="oil"
            stackId="1"
            stroke="var(--fuel-oil)"
            fill="var(--fuel-oil)"
            fillOpacity={0.95}
            name="Oil"
            hide={!visibility.oil}
          />
          <Area
            yAxisId="generation"
            type="monotone"
            dataKey="gas"
            stackId="1"
            stroke="var(--fuel-gas)"
            fill="var(--fuel-gas)"
            fillOpacity={0.95}
            name="Gas"
            hide={!visibility.gas}
          />
          <Area
            yAxisId="generation"
            type="monotone"
            dataKey="coal"
            stackId="1"
            stroke="var(--fuel-coal)"
            fill="var(--fuel-coal)"
            fillOpacity={0.95}
            name="Coal"
            hide={!visibility.coal}
          />
          
          {/* Renewables in reverse (Other first = bottom of renewables, Solar last = visual top) */}
          <Area
            yAxisId="generation"
            type="monotone"
            dataKey="other"
            stackId="1"
            stroke="var(--fuel-other)"
            fill="var(--fuel-other)"
            fillOpacity={0.95}
            name="Other"
            hide={!visibility.other}
          />
          <Area
            yAxisId="generation"
            type="monotone"
            dataKey="imports"
            stackId="1"
            stroke="var(--fuel-imports)"
            fill="var(--fuel-imports)"
            fillOpacity={0.95}
            name="Imports"
            hide={!visibility.imports}
          />
          <Area
            yAxisId="generation"
            type="monotone"
            dataKey="batteries"
            stackId="1"
            stroke="var(--fuel-batteries)"
            fill="var(--fuel-batteries)"
            fillOpacity={0.95}
            name="Batteries"
            hide={!visibility.batteries}
          />
          <Area
            yAxisId="generation"
            type="monotone"
            dataKey="biomass"
            stackId="1"
            stroke="var(--fuel-biomass)"
            fill="var(--fuel-biomass)"
            fillOpacity={0.95}
            name="Biomass"
            hide={!visibility.biomass}
          />
          <Area
            yAxisId="generation"
            type="monotone"
            dataKey="geothermal"
            stackId="1"
            stroke="var(--fuel-geothermal)"
            fill="var(--fuel-geothermal)"
            fillOpacity={0.95}
            name="Geothermal"
            hide={!visibility.geothermal}
          />
          <Area
            yAxisId="generation"
            type="monotone"
            dataKey="hydro"
            stackId="1"
            stroke="var(--fuel-hydro)"
            fill="var(--fuel-hydro)"
            fillOpacity={0.95}
            name="Hydro"
            hide={!visibility.hydro}
          />
          <Area
            yAxisId="generation"
            type="monotone"
            dataKey="wind"
            stackId="1"
            stroke="var(--fuel-wind)"
            fill="var(--fuel-wind)"
            fillOpacity={0.95}
            name="Wind"
            hide={!visibility.wind}
          />
          <Area
            yAxisId="generation"
            type="monotone"
            dataKey="solar"
            stackId="1"
            stroke="var(--fuel-solar)"
            fill="var(--fuel-solar)"
            fillOpacity={0.95}
            name="Solar"
            hide={!visibility.solar}
          />

          {/* Lines for LMP components (right Y-axis) */}
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="lmp"
            stroke="var(--price-lmp)"
            strokeWidth={3}
            dot={{ fill: "var(--price-lmp)", r: 2 }}
            name="LMP"
            connectNulls
            hide={!hasPricingData || !visibility.lmp}
          />
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="spp"
            stroke="var(--price-spp)"
            strokeWidth={2}
            dot={{ fill: "var(--price-spp)", r: 3 }}
            name="SPP"
            connectNulls
            hide={!hasPricingData || !visibility.spp}
          />
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="energy"
            stroke="var(--price-energy)"
            strokeWidth={2}
            dot={false}
            name="Energy"
            connectNulls
            hide={!hasPricingData || !visibility.energy}
          />
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="congestion"
            stroke="var(--price-congestion)"
            strokeWidth={2}
            dot={false}
            name="Congestion"
            connectNulls
            hide={!hasPricingData || !visibility.congestion}
          />
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="loss"
            stroke="var(--price-loss)"
            strokeWidth={2}
            dot={false}
            name="Loss"
            connectNulls
            hide={!hasPricingData || !visibility.loss}
          />
          
          {/* Zero reference line for clarity when showing charging */}
          <ReferenceLine 
            y={0} 
            yAxisId="generation"
            stroke="var(--text-secondary)" 
            strokeDasharray="3 3"
            strokeOpacity={0.5}
          />
          
          {/* Charging area - separate stack below zero */}
          <Area
            yAxisId="generation"
            type="monotone"
            dataKey="charging"
            stackId="charging"
            stroke="var(--fuel-charging)"
            fill="var(--fuel-charging)"
            fillOpacity={0.56}
            name="Charging"
            hide={!visibility.charging}
          />
        </ComposedChart>
      </ResponsiveContainer>
        </div>
        
        {/* Custom Grouped Legend */}
        <div className="landscape:space-y-2 landscape:w-auto flex-shrink-0 legend-groups-container chart-legend-area">
        {LEGEND_GROUPS.map((group) => {
          // Filter items to only show those with data
          const itemsWithData = group.items.filter(item => hasDataForKey(item));
          
          // Skip the entire group if no items have data
          if (itemsWithData.length === 0) return null;
          
          const allVisible = itemsWithData.every(item => visibility[item]);
          const someVisible = itemsWithData.some(item => visibility[item]);
          
          // Toggle function for this specific group's items with data
          const toggleThisGroup = () => {
            const newState = { ...visibility };
            itemsWithData.forEach(item => {
              newState[item] = !allVisible;
            });
            setVisibility(newState);
          };
          
          return (
            <div key={group.name} className="legend-group-block">
              {/* Group Header */}
              <button
                onClick={toggleThisGroup}
                className="text-sm font-semibold transition-colors mb-1 flex items-center gap-2"
                style={{ color: 'var(--text-primary)' }}
              >
                <div className="relative flex items-center justify-center w-3.5 h-3.5">
                  <input
                    type="checkbox"
                    checked={allVisible}
                    onChange={toggleThisGroup}
                    onClick={(e) => e.stopPropagation()}
                    className="appearance-none w-3.5 h-3.5 border-2 rounded cursor-pointer transition-colors"
                    style={{ 
                      borderColor: allVisible ? 'var(--text-primary)' : 'var(--text-secondary)',
                    }}
                  />
                  {allVisible && (
                    <svg 
                      className="absolute pointer-events-none" 
                      width="10" 
                      height="10" 
                      viewBox="0 0 12 12"
                      style={{ left: '2px', top: '2px' }}
                    >
                      <path 
                        d="M2 6L5 9L10 3" 
                        stroke="var(--text-primary)" 
                        strokeWidth="2" 
                        fill="none" 
                        strokeLinecap="round" 
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </div>
                <span className={allVisible ? '' : 'line-through opacity-60'}>
                  {group.name}
                </span>
              </button>
              
              {/* Individual Items */}
              <div className="flex flex-col gap-1">
                {itemsWithData.map((item) => {
                  const isVisible = visibility[item];
                  const color = COLOR_VARS[item];
                  const label = item === 'lmp' ? 'Total (LMP)' : item === 'spp' ? 'Total (SPP)' : item.charAt(0).toUpperCase() + item.slice(1);
                  
                  return (
                    <button
                      key={item}
                      onClick={() => toggleItem(item)}
                      className="legend-item-button flex items-center gap-2 px-3 py-1 rounded-md text-sm transition-all w-full"
                      style={{
                        backgroundColor: isVisible ? 'var(--bg-secondary)' : 'var(--border-lighter)',
                        opacity: isVisible ? 1 : 0.5,
                        boxShadow: isVisible ? '0 1px 2px var(--border-lighter)' : 'none',
                      }}
                    >
                      <span
                        className="w-4 h-4 rounded"
                        style={{ 
                          backgroundColor: color,
                          opacity: isVisible ? 1 : 0.3
                        }}
                      />
                      <span
                        className={`font-medium ${!isVisible ? 'line-through' : ''}`}
                        style={{ color: isVisible ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                      >
                        {label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        </div>
      </div>
      
    </div>
  );
}
