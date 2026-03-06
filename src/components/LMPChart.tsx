"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { LMPDataPoint } from "@/types/energy";

interface LMPChartProps {
  data: LMPDataPoint[];
}

export default function LMPChart({ data }: LMPChartProps) {
  // Transform data for Recharts
  const chartData = data.map((point) => {
    // Extract hour from ISO timestamp (e.g., "2024-03-01T05:00:00+00:00" -> 5)
    const hourMatch = point.time.match(/T(\d{2})/);
    const hour = hourMatch ? parseInt(hourMatch[1], 10) : 0;

    return {
      hour,
      lmp: Number(point.lmp.toFixed(2)),
      energy: Number(point.energy.toFixed(2)),
      congestion: Number(point.congestion.toFixed(2)),
      loss: Number(point.loss.toFixed(2)),
    };
  });

  // Ensure we have all 24 hours
  const allHours = Array.from({ length: 24 }, (_, i) => {
    const existing = chartData.find((d) => d.hour === i);
    return (
      existing || {
        hour: i,
        lmp: 0,
        energy: 0,
        congestion: 0,
        loss: 0,
      }
    );
  });

  // Sort by hour
  allHours.sort((a, b) => a.hour - b.hour);

  return (
    <div className="bg-white/5 rounded-lg p-6">
      <h2 className="text-xl font-semibold mb-4">
        Locational Marginal Price (LMP)
      </h2>
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={allHours}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
          <XAxis
            dataKey="hour"
            stroke="#9ca3af"
            label={{ value: "Hour", position: "insideBottom", offset: -5 }}
          />
          <YAxis
            stroke="#9ca3af"
            label={{
              value: "Price ($/MWh)",
              angle: -90,
              position: "insideLeft",
            }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "rgba(15, 23, 42, 0.95)",
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: "6px",
            }}
            labelStyle={{ color: "#e5e7eb" }}
            itemStyle={{ color: "#e5e7eb" }}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey="lmp"
            stroke="#3b82f6"
            strokeWidth={2}
            name="LMP"
            dot={{ fill: "#3b82f6", r: 3 }}
            activeDot={{ r: 5 }}
          />
          <Line
            type="monotone"
            dataKey="energy"
            stroke="#10b981"
            strokeWidth={2}
            name="Energy"
            dot={{ fill: "#10b981", r: 3 }}
            activeDot={{ r: 5 }}
          />
          <Line
            type="monotone"
            dataKey="congestion"
            stroke="#f59e0b"
            strokeWidth={2}
            name="Congestion"
            dot={{ fill: "#f59e0b", r: 3 }}
            activeDot={{ r: 5 }}
          />
          <Line
            type="monotone"
            dataKey="loss"
            stroke="#ef4444"
            strokeWidth={2}
            name="Loss"
            dot={{ fill: "#ef4444", r: 3 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="text-xs text-gray-400 mt-4">
        <p>
          <strong>LMP</strong> = Energy + Congestion + Loss. All prices in
          $/MWh.
        </p>
      </div>
    </div>
  );
}
