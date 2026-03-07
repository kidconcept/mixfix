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
  TooltipProps,
} from "recharts";
import { SOURCE_COLORS, PRICING_COLORS } from "@/lib/theme";
import { HistoricalRecord, LMPDataPoint } from "@/types/energy";
import { getTimezoneAbbreviation } from "@/lib/timezone";

interface CombinedChartProps {
  fuelMixData: HistoricalRecord[]; // Secondary/enhancement data (optional)
  pricingData: LMPDataPoint[]; // Primary data (required for chart display)
  location?: string; // ISO/RTO identifier for timezone display
}

type DataKey = 'solar' | 'wind' | 'hydro' | 'geothermal' | 'biomass' | 'batteries' | 'imports' | 'other' | 'coal' | 'gas' | 'oil' | 'nuclear' | 'lmp' | 'energy' | 'congestion' | 'loss';

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
      {filteredPayload.map((item, index) => {
        const dataKey = String(item.dataKey || '');
        const isPricing = ["lmp", "energy", "congestion", "loss"].includes(dataKey.toLowerCase());
        const displayName = dataKey ? 
          (isPricing ? dataKey.toUpperCase() : dataKey.charAt(0).toUpperCase() + dataKey.slice(1))
          : item.name;
        const formattedValue = isPricing 
          ? `$${Number(item.value).toFixed(2)}/MWh`
          : `${Number(item.value).toFixed(2)} GW`;
        
        return (
          <div key={index} style={{ color: "var(--text-secondary)", fontSize: "14px" }}>
            <span style={{ color: item.color }}>{displayName}</span>: {formattedValue}
          </div>
        );
      })}
    </div>
  );
};

export default function CombinedChart({ fuelMixData, pricingData, location }: CombinedChartProps) {
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

    return {
      hour,
      // Fuel mix data (already in GW from API)
      solar: fuelData ? toNumber(fuelData.solar) : 0,
      wind: fuelData ? toNumber(fuelData.wind) : 0,
      hydro: fuelData ? toNumber(fuelData.hydro) : 0,
      geothermal: fuelData ? toNumber(fuelData.geothermal) : 0,
      biomass: fuelData ? toNumber(fuelData.biomass) : 0,
      batteries: fuelData ? toNumber(fuelData.batteries) : 0,
      imports: fuelData ? toNumber(fuelData.imports) : 0,
      nuclear: fuelData ? toNumber(fuelData.nuclear) : 0,
      gas: fuelData ? toNumber(fuelData.gas) : 0,
      coal: fuelData ? toNumber(fuelData.coal) : 0,
      oil: fuelData ? toNumber(fuelData.oil) : 0,
      other: fuelData ? toNumber(fuelData.other) : 0,
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
     'coal', 'gas', 'oil', 'nuclear', 'lmp', 'energy', 'congestion', 'loss']
      .filter(key => hasDataForKey(key as DataKey)) as DataKey[]
  );

  return (
    <div className="rounded-lg" style={{ background: 'transparent' }}>
      {/* Y-axis labels above chart */}
      <div className="flex justify-end items-center mb-2">
        <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Generation in GW
        </div>
      </div>
      
      {/* Chart and Legend Side-by-Side */}
      <div className="flex flex-col landscape:flex-row gap-2">
        {/* Chart */}
        <div className="flex-1">
          <ResponsiveContainer width="100%" height={500}>
        <ComposedChart
          data={combinedData}
          margin={{
            top: 5,
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
              value: location ? `Hour (${getTimezoneAbbreviation(location)})` : "Hour", 
              position: "insideBottom", 
              offset: -10, 
              fill: "var(--text-primary)", 
              fontWeight: 500 
            }}
            tick={{ fill: "var(--text-primary)" }}
            tickFormatter={(value) => (value % 2 === 0 && value !== 0 && value !== 24) ? value.toString() : ''}
            height={40}
          />
          
          {/* Left Y-axis for Price */}
          <YAxis 
            yAxisId="price"
            stroke="var(--text-primary)"
            tick={{ fill: "var(--text-primary)", fontWeight: 500 }}
            width={40}
          />
          
          {/* Right Y-axis for Generation */}
          <YAxis 
            yAxisId="generation"
            orientation="right"
            stroke="var(--text-primary)"
            tick={{ fill: "var(--text-primary)", fontWeight: 500 }}
            width={40}
          />
          
          <Tooltip content={<CustomTooltip keysWithData={keysWithData} />} />
          
          {/* Stacked areas for fuel mix (right Y-axis) */}
          {/* Order: Consumables → Nuclear → Renewables → Other */}
          
          {/* Consumables */}
          <Area
            yAxisId="generation"
            type="monotone"
            dataKey="coal"
            stackId="1"
            stroke={SOURCE_COLORS.coal}
            fill={SOURCE_COLORS.coal}
            fillOpacity={0.95}
            name="Coal"
            hide={!visibility.coal}
          />
          <Area
            yAxisId="generation"
            type="monotone"
            dataKey="gas"
            stackId="1"
            stroke={SOURCE_COLORS.gas}
            fill={SOURCE_COLORS.gas}
            fillOpacity={0.95}
            name="Gas"
            hide={!visibility.gas}
          />
          <Area
            yAxisId="generation"
            type="monotone"
            dataKey="oil"
            stackId="1"
            stroke={SOURCE_COLORS.oil}
            fill={SOURCE_COLORS.oil}
            fillOpacity={0.95}
            name="Oil"
            hide={!visibility.oil}
          />
          <Area
            yAxisId="generation"
            type="monotone"
            dataKey="nuclear"
            stackId="1"
            stroke={SOURCE_COLORS.nuclear}
            fill={SOURCE_COLORS.nuclear}
            fillOpacity={0.95}
            name="Nuclear"
            hide={!visibility.nuclear}
          />
          
          {/* Renewables */}
          <Area
            yAxisId="generation"
            type="monotone"
            dataKey="solar"
            stackId="1"
            stroke={SOURCE_COLORS.solar}
            fill={SOURCE_COLORS.solar}
            fillOpacity={0.95}
            name="Solar"
            hide={!visibility.solar}
          />
          <Area
            yAxisId="generation"
            type="monotone"
            dataKey="wind"
            stackId="1"
            stroke={SOURCE_COLORS.wind}
            fill={SOURCE_COLORS.wind}
            fillOpacity={0.95}
            name="Wind"
            hide={!visibility.wind}
          />
          <Area
            yAxisId="generation"
            type="monotone"
            dataKey="hydro"
            stackId="1"
            stroke={SOURCE_COLORS.hydro}
            fill={SOURCE_COLORS.hydro}
            fillOpacity={0.95}
            name="Hydro"
            hide={!visibility.hydro}
          />
          <Area
            yAxisId="generation"
            type="monotone"
            dataKey="geothermal"
            stackId="1"
            stroke={SOURCE_COLORS.geothermal}
            fill={SOURCE_COLORS.geothermal}
            fillOpacity={0.95}
            name="Geothermal"
            hide={!visibility.geothermal}
          />
          <Area
            yAxisId="generation"
            type="monotone"
            dataKey="biomass"
            stackId="1"
            stroke={SOURCE_COLORS.biomass}
            fill={SOURCE_COLORS.biomass}
            fillOpacity={0.95}
            name="Biomass"
            hide={!visibility.biomass}
          />
          <Area
            yAxisId="generation"
            type="monotone"
            dataKey="batteries"
            stackId="1"
            stroke={SOURCE_COLORS.batteries}
            fill={SOURCE_COLORS.batteries}
            fillOpacity={0.95}
            name="Batteries"
            hide={!visibility.batteries}
          />
          <Area
            yAxisId="generation"
            type="monotone"
            dataKey="imports"
            stackId="1"
            stroke={SOURCE_COLORS.imports}
            fill={SOURCE_COLORS.imports}
            fillOpacity={0.95}
            name="Imports"
            hide={!visibility.imports}
          />
          <Area
            yAxisId="generation"
            type="monotone"
            dataKey="other"
            stackId="1"
            stroke={SOURCE_COLORS.other}
            fill={SOURCE_COLORS.other}
            fillOpacity={0.95}
            name="Other"
            hide={!visibility.other}
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
                <span className={allVisible ? '' : 'line-through opacity-60'}>
                  {group.name}
                </span>
              </button>
              
              {/* Individual Items */}
              <div className="flex flex-col gap-1">
                {itemsWithData.map((item) => {
                  const isVisible = visibility[item];
                  const color = item in SOURCE_COLORS 
                    ? SOURCE_COLORS[item as keyof typeof SOURCE_COLORS]
                    : PRICING_COLORS[item as keyof typeof PRICING_COLORS];
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
