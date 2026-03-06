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
} from "recharts";
import { SOURCE_COLORS } from "@/lib/energyData";
import { HistoricalRecord, LMPDataPoint } from "@/types/energy";

interface CombinedChartProps {
  fuelMixData: HistoricalRecord[];
  pricingData: LMPDataPoint[];
}

type DataKey = 'gas' | 'coal' | 'oil' | 'nuclear' | 'solar' | 'wind' | 'hydro' | 'other' | 'lmp' | 'energy' | 'congestion' | 'loss';

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
    items: ['solar', 'wind', 'hydro', 'other']
  },
  {
    name: "Consumables",
    items: ['gas', 'coal', 'oil', 'nuclear']
  }
];

const PRICING_COLORS: Record<string, string> = {
  lmp: "#2D8659",
  energy: "#4CAF7D",
  congestion: "#6BC99A",
  loss: "#8FD9B3"
};

export default function CombinedChart({ fuelMixData, pricingData }: CombinedChartProps) {
  // Track visibility state for each data series
  const [visibility, setVisibility] = useState<Record<DataKey, boolean>>({
    gas: true,
    coal: true,
    oil: true,
    nuclear: true,
    solar: true,
    wind: true,
    hydro: true,
    other: true,
    lmp: true,
    energy: true,
    congestion: true,
    loss: true,
  });

  const toggleItem = (key: DataKey) => {
    // Show only the clicked item, hide everything else
    const newState: Record<DataKey, boolean> = {
      gas: false,
      coal: false,
      oil: false,
      nuclear: false,
      solar: false,
      wind: false,
      hydro: false,
      other: false,
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
      <div className="text-center text-gray-500 py-8">
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

  // Combine both datasets for all 24 hours
  const combinedData = Array.from({ length: 24 }, (_, hour) => {
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

  return (
    <div className="rounded-lg" style={{ background: 'transparent' }}>
      {/* Y-axis labels above chart */}
      <div className="flex justify-between items-center mb-2">
        <div className="text-sm font-semibold" style={{ color: '#000000' }}>
          Price in $/MWh
        </div>
        <div className="text-sm font-semibold" style={{ color: '#000000' }}>
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
            bottom: 5,
          }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0, 0, 0, 0.08)" />
          
          <XAxis 
            dataKey="hour" 
            stroke="#000000"
            label={{ value: "Hour", position: "insideBottom", offset: -10, fill: "#000000", fontWeight: 500 }}
            tick={{ fill: "#000000" }}
            height={40}
          />
          
          {/* Left Y-axis for Price */}
          <YAxis 
            yAxisId="price"
            stroke="#000000"
            tick={{ fill: "#000000", fontWeight: 500 }}
            width={40}
          />
          
          {/* Right Y-axis for Generation */}
          <YAxis 
            yAxisId="generation"
            orientation="right"
            stroke="#000000"
            tick={{ fill: "#000000", fontWeight: 500 }}
            width={40}
          />
          
          <Tooltip
            contentStyle={{
              backgroundColor: "rgba(255, 255, 255, 0.98)",
              border: "1px solid rgba(0, 0, 0, 0.1)",
              borderRadius: "8px",
              boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
              fontFamily: "Inter, sans-serif"
            }}
            labelStyle={{ color: "#2D3436", fontWeight: 600 }}
            labelFormatter={(hour) => `Hour ${hour}:00`}
            formatter={(value: any, name: string) => {
              // Format pricing components
              if (["lmp", "energy", "congestion", "loss"].includes(name.toLowerCase())) {
                return [`$${Number(value).toFixed(2)}/MWh`, name.toUpperCase()];
              }
              // Format fuel mix components
              return [`${Number(value).toFixed(2)} GW`, name.charAt(0).toUpperCase() + name.slice(1)];
            }}
          />
          
          {/* Stacked areas for fuel mix (right Y-axis) - ordered: fossil fuels, nuclear, renewables, other */}
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
            stroke="#2D8659"
            strokeWidth={3}
            dot={{ fill: "#2D8659", r: 2 }}
            name="LMP"
            connectNulls
            hide={!visibility.lmp}
          />
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="energy"
            stroke="#4CAF7D"
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
            stroke="#6BC99A"
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
            stroke="#8FD9B3"
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
          const allVisible = group.items.every(item => visibility[item]);
          const someVisible = group.items.some(item => visibility[item]);
          
          return (
            <div key={group.name}>
              {/* Group Header */}
              <button
                onClick={() => toggleGroup(group)}
                className="text-sm font-semibold text-gray-700 hover:text-teal-600 transition-colors mb-1 flex items-center gap-2"
              >
                <span className={allVisible ? '' : 'line-through opacity-60'}>
                  {group.name}
                </span>
              </button>
              
              {/* Individual Items */}
              <div className="flex flex-col gap-1">
                {group.items.map((item) => {
                  const isVisible = visibility[item];
                  const color = item in SOURCE_COLORS 
                    ? SOURCE_COLORS[item as keyof typeof SOURCE_COLORS]
                    : PRICING_COLORS[item];
                  const label = item.charAt(0).toUpperCase() + item.slice(1);
                  
                  return (
                    <button
                      key={item}
                      onClick={() => toggleItem(item)}
                      className={`flex items-center gap-2 px-3 py-1 rounded-md text-sm transition-all w-full ${
                        isVisible 
                          ? 'bg-white/80 hover:bg-white shadow-sm' 
                          : 'bg-gray-100 opacity-50 hover:opacity-70'
                      }`}
                    >
                      <span
                        className="w-4 h-4 rounded"
                        style={{ 
                          backgroundColor: color,
                          opacity: isVisible ? 1 : 0.3
                        }}
                      />
                      <span className={`font-medium ${isVisible ? 'text-gray-800' : 'text-gray-500 line-through'}`}>
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
      
      <div className="text-sm text-gray-600 mt-4">
        {hasPricingData ? (
          <p>
            <strong className="text-gray-800">LMP</strong> = Energy + Congestion + Loss. All prices in $/MWh.
          </p>
        ) : (
          <p className="text-amber-700 font-medium">
            Pricing data unavailable - showing generation mix only.
          </p>
        )}
      </div>
    </div>
  );
}
