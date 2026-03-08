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
import { HistoricalRecord, LMPDataPoint } from "@/types/energy";
import { getTimezoneAbbreviation } from "@/lib/timezone";

interface CombinedChartProps {
  fuelMixData: HistoricalRecord[]; // Secondary/enhancement data (optional)
  pricingData: LMPDataPoint[]; // Primary data (required for chart display)
  location?: string; // ISO/RTO identifier for timezone display
  baName?: string; // BA name for Y-axis label
  zoneName?: string; // Zone name for Y-axis label
}

type DataKey = 'solar' | 'wind' | 'hydro' | 'geothermal' | 'biomass' | 'batteries' | 'imports' | 'other' | 'coal' | 'gas' | 'oil' | 'nuclear' | 'charging' | 'lmp' | 'energy' | 'congestion' | 'loss';

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
    items: ['lmp', 'energy', 'congestion', 'loss']
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

// Custom Tooltip Component
const CustomTooltip = ({ 
  active, 
  payload, 
  label,
  keysWithData 
}: TooltipProps<any, any> & { keysWithData: Set<DataKey> }) => {
  if (!active || !payload || !payload.length) return null;

  // Filter payload to only show items with data across the time range
  const filteredPayload = payload.filter(item => {
    const dataKey = item.dataKey as DataKey;
    return keysWithData.has(dataKey);
  });

  if (filteredPayload.length === 0) return null;

  // Sort to match LEGEND_GROUPS order
  const sortOrder: DataKey[] = [
    'lmp', 'energy', 'congestion', 'loss',
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
        {label === 24 ? 'Hour 0:00 (next day)' : `Hour ${label}:00`}
      </div>
      {sortedPayload.map((item, index) => {
        const dataKey = String(item.dataKey || '');
        const isPricing = ["lmp", "energy", "congestion", "loss"].includes(dataKey.toLowerCase());
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
            fontSize: "14px",
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

export default function CombinedChart({ fuelMixData, pricingData, location, baName, zoneName }: CombinedChartProps) {
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
    // Pricing (4)
    lmp: true,
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
      // Pricing (4)
      lmp: false,
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
        No data available for the selected day.
      </div>
    );
  }

  const hasPricingData = pricingData && pricingData.length > 0;

  // Extract and format the date from the data
  const getFormattedDate = (): string => {
    const dateStr = pricingData?.[0]?.time || fuelMixData?.[0]?.date;
    if (!dateStr) return "";
    
    // Extract date components (YYYY-MM-DD) and create a local date
    // This avoids timezone issues and handles hour 24 timestamps
    const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return "";
    
    const date = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
    const options: Intl.DateTimeFormatOptions = { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    };
    const formattedDate = date.toLocaleDateString('en-US', options);
    const tz = location ? getTimezoneAbbreviation(location) : "";
    return tz ? `${formattedDate} (${tz})` : formattedDate;
  };

  // Process fuel mix data by hour
  const fuelByHour: Record<number, HistoricalRecord> = {};
  if (fuelMixData && fuelMixData.length > 0) {
    fuelMixData.forEach(item => {
      const dateStr = typeof item.date === 'string' ? item.date : '';
      const hourMatch = dateStr.match(/T(\d{2})/);
      const hour = hourMatch ? parseInt(hourMatch[1], 10) : 0;
      fuelByHour[hour] = item;
    });
  }

  // Process pricing data by hour
  const pricingByHour: Record<number, LMPDataPoint> = {};
  if (pricingData && pricingData.length > 0) {
    pricingData.forEach(point => {
      const hourMatch = point.time.match(/T(\d{2})/);
      const hour = hourMatch ? parseInt(hourMatch[1], 10) : 0;
      pricingByHour[hour] = point;
    });
  }

  // Combine both datasets for 25 hours (0-24, where 24 = next day's hour 0)
  const combinedData = Array.from({ length: 25 }, (_, hour) => {
    const fuelData = fuelByHour[hour];
    const priceData = pricingByHour[hour];

    // Helper to safely get numeric value (data is already in GW from API)
    const toNumber = (val: number | string | undefined): number => {
      if (val === undefined) return 0;
      const num = typeof val === 'string' ? parseFloat(val) : val;
      return isNaN(num) ? 0 : num;
    };

    // Extract raw values
    const rawSolar = fuelData ? toNumber(fuelData.solar) : 0;
    const rawWind = fuelData ? toNumber(fuelData.wind) : 0;
    const rawHydro = fuelData ? toNumber(fuelData.hydro) : 0;
    const rawGeothermal = fuelData ? toNumber(fuelData.geothermal) : 0;
    const rawBiomass = fuelData ? toNumber(fuelData.biomass) : 0;
    const rawBatteries = fuelData ? toNumber(fuelData.batteries) : 0;
    const rawImports = fuelData ? toNumber(fuelData.imports) : 0;
    const rawOther = fuelData ? toNumber(fuelData.other) : 0;
    const rawNuclear = fuelData ? toNumber(fuelData.nuclear) : 0;
    const rawGas = fuelData ? toNumber(fuelData.gas) : 0;
    const rawCoal = fuelData ? toNumber(fuelData.coal) : 0;
    const rawOil = fuelData ? toNumber(fuelData.oil) : 0;

    // Split negatives: positive part stays, negative part accumulates to charging
    let chargingTotal = 0;
    const split = (val: number) => {
      if (val < 0) {
        chargingTotal += Math.abs(val);
        return 0;
      }
      return val;
    };

    return {
      hour,
      // Fuel mix data - positive parts only
      solar: split(rawSolar),
      wind: split(rawWind),
      hydro: split(rawHydro),
      geothermal: split(rawGeothermal),
      biomass: split(rawBiomass),
      batteries: split(rawBatteries),
      imports: split(rawImports),
      other: split(rawOther),
      nuclear: split(rawNuclear),
      gas: split(rawGas),
      coal: split(rawCoal),
      oil: split(rawOil),
      // Charging (accumulated negatives)
      charging: chargingTotal,
      // Pricing data - all components
      lmp: priceData ? Number(priceData.lmp.toFixed(2)) : null,
      energy: priceData ? Number(priceData.energy.toFixed(2)) : null,
      congestion: priceData ? Number(priceData.congestion.toFixed(2)) : null,
      loss: priceData ? Number(priceData.loss.toFixed(2)) : null,
    };
  });

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
     'coal', 'gas', 'oil', 'nuclear', 'charging', 'lmp', 'energy', 'congestion', 'loss']
      .filter(key => hasDataForKey(key as DataKey)) as DataKey[]
  );

  return (
    <div className="rounded-lg" style={{ background: 'transparent' }}>
      {/* Chart and Legend Side-by-Side */}
      <div className="flex flex-col landscape:flex-row gap-2">
        {/* Chart */}
        <div className="flex-1">
          <ResponsiveContainer width="100%" height={500}>
        <ComposedChart
          data={combinedData}
          margin={{
            top: 30,
            right: 0,
            left: 0,
            bottom: 25,
          }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-lighter)" />
          
          <XAxis 
            dataKey="hour" 
            stroke="var(--text-primary)"
            label={{ 
              value: getFormattedDate(), 
              position: "insideBottom", 
              offset: -10, 
              fill: "var(--text-primary)", 
              fontWeight: 400,
              fontSize: 14
            }}
            tick={{ fill: "var(--text-primary)" }}
            tickFormatter={(value) => (value % 2 === 0 && value !== 0 && value !== 24) ? value.toString() : ''}
            height={40}
          />
          
          {/* Left Y-axis for Price */}
          <YAxis 
            yAxisId="price"
            stroke="var(--text-primary)"
            tick={{ fill: "var(--text-primary)" }}
            width={40}
            domain={hasPricingData ? undefined : [0, 3]}
            ticks={hasPricingData ? undefined : [0, 1, 2, 3]}
            tickFormatter={(value) => hasPricingData ? value : ''}
            label={{ 
              value: hasPricingData 
                ? (zoneName ? `${zoneName} in $/MWh` : "Pricing in $/MWh")
                : "Pricing unavailable",
              angle: 0, 
              position: "insideTopLeft",
              offset: -23,
              dx: 65,
              fill: "var(--text-primary)", 
              fontWeight: 400,
              fontSize: 14,
              textAnchor: "start"
            }}
          />
          
          {/* Right Y-axis for Generation */}
          <YAxis 
            yAxisId="generation"
            orientation="right"
            stroke="var(--text-primary)"
            tick={{ fill: "var(--text-primary)" }}
            width={40}
            label={{ 
              value: baName ? `${baName} mix in GW` : "Generation in GW", 
              angle: 0, 
              position: "insideTopRight",
              offset: -23,
              dx: -60,
              fill: "var(--text-primary)", 
              fontWeight: 400,
              fontSize: 14,
              textAnchor: "end"
            }}
          />
          
          <Tooltip content={<CustomTooltip keysWithData={keysWithData} />} />
          
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

          {/* Lines for LMP components (left Y-axis) */}
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="lmp"
            stroke="var(--price-lmp)"
            strokeWidth={3}
            dot={{ fill: "var(--price-lmp)", r: 2 }}
            name="LMP"
            connectNulls
            hide={!visibility.lmp}
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
            hide={!visibility.energy}
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
            hide={!visibility.congestion}
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
            hide={!visibility.loss}
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
        <div className="space-y-2 landscape:w-auto flex-shrink-0">
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
            <div key={group.name}>
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
                  const label = item.charAt(0).toUpperCase() + item.slice(1);
                  
                  return (
                    <button
                      key={item}
                      onClick={() => toggleItem(item)}
                      className="flex items-center gap-2 px-3 py-1 rounded-md text-sm transition-all w-full"
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
