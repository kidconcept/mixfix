"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { SOURCE_COLORS } from "@/lib/energyData";
import { HistoricalRecord } from "@/types/energy";

interface HourlyMixChartProps {
  data: HistoricalRecord[];
}

export default function HourlyMixChart({ data }: HourlyMixChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="text-center text-gray-500 py-8">
        No hourly data available for the selected day.
      </div>
    );
  }

  // Assuming the API returns data for each fuel type per hour.
  // We need to process it into a format Recharts can use for stacked bars.
  
  // Create a map of existing data by hour
  const dataByHour: Record<number, HistoricalRecord> = {};
  data.forEach(item => {
    const dateStr = typeof item.date === 'string' ? item.date : '';
    const hourMatch = dateStr.match(/T(\d{2})/);
    const hour = hourMatch ? parseInt(hourMatch[1], 10) : 0;
    dataByHour[hour] = item;
  });

  // Generate all 24 hours with data or empty values
  const processedData = Array.from({ length: 24 }, (_, hour) => {
    const existingData = dataByHour[hour];
    return {
      hour: hour.toString(),
      hourSort: hour,
      solar: existingData?.solar ?? 0,
      wind: existingData?.wind ?? 0,
      hydro: existingData?.hydro ?? 0,
      nuclear: existingData?.nuclear ?? 0,
      gas: existingData?.gas ?? 0,
      coal: existingData?.coal ?? 0,
      oil: existingData?.oil ?? 0,
      other: existingData?.other ?? 0,
    };
  });


  return (
    <div className="bg-white/5 rounded-lg p-4 mt-8">
      <h3 className="text-lg font-semibold mb-4">Hourly Generation (GW)</h3>
      <ResponsiveContainer width="100%" height={400}>
        <BarChart
          data={processedData}
          margin={{
            top: 20,
            right: 30,
            left: 20,
            bottom: 5,
          }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.1)" />
          <XAxis 
            dataKey="hour" 
            stroke="rgba(255, 255, 255, 0.7)"
          />
          <YAxis 
            stroke="rgba(255, 255, 255, 0.7)"
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "rgba(10, 15, 26, 0.8)",
              borderColor: "rgba(255, 255, 255, 0.2)",
            }}
          />
          <Legend />
          {Object.keys(SOURCE_COLORS).map((source) => (
            <Bar
              key={source}
              dataKey={source}
              stackId="a"
              fill={SOURCE_COLORS[source as keyof typeof SOURCE_COLORS]}
              name={source.charAt(0).toUpperCase() + source.slice(1)}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
