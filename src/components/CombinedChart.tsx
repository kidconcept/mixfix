"use client";

import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { SOURCE_COLORS } from "@/lib/energyData";
import { HistoricalRecord, LMPDataPoint } from "@/types/energy";

interface CombinedChartProps {
  fuelMixData: HistoricalRecord[];
  pricingData: LMPDataPoint[];
}

export default function CombinedChart({ fuelMixData, pricingData }: CombinedChartProps) {
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
    <div className="rounded-lg p-6" style={{ background: 'transparent' }}>
      <h2 className="text-2xl font-semibold mb-6 text-gray-800">
        Hourly Generation & Pricing
      </h2>
      <ResponsiveContainer width="100%" height={500}>
        <ComposedChart
          data={combinedData}
          margin={{
            top: 20,
            right: 60,
            left: 20,
            bottom: 20,
          }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0, 0, 0, 0.08)" />
          
          <XAxis 
            dataKey="hour" 
            stroke="#2D3436"
            label={{ value: "Hour", position: "insideBottom", offset: -10, fill: "#2D3436", fontWeight: 500 }}
            tick={{ fill: "#2D3436" }}
          />
          
          {/* Left Y-axis for Price */}
          <YAxis 
            yAxisId="price"
            stroke="#2D8659"
            label={{ 
              value: "Price ($/MWh)", 
              angle: -90, 
              position: "insideLeft",
              fill: "#2D8659",
              fontWeight: 600
            }}
            tick={{ fill: "#2D8659", fontWeight: 500 }}
          />
          
          {/* Right Y-axis for Generation */}
          <YAxis 
            yAxisId="generation"
            orientation="right"
            stroke="#2D3436"
            label={{ 
              value: "Generation (GW)", 
              angle: 90, 
              position: "insideRight",
              fill: "#2D3436",
              fontWeight: 600
            }}
            tick={{ fill: "#2D3436", fontWeight: 500 }}
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
          
          <Legend 
            wrapperStyle={{ paddingTop: "20px", fontFamily: "Inter, sans-serif" }}
            iconType="rect"
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
          />
        </ComposedChart>
      </ResponsiveContainer>
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
