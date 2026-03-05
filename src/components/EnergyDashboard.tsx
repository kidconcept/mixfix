"use client";

import useSWR from "swr";
import { RegionSnapshot, HistoricalRecord } from "@/types/energy";

interface ApiResponse {
  snapshot: RegionSnapshot;
  historical: HistoricalRecord[];
}

interface EnergyDashboardProps {
  location: string | null;
}

// Move fetcher outside component to prevent recreation
const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function EnergyDashboard({ location }: EnergyDashboardProps) {
  const apiUrl = location ? `/api/energy?location=${encodeURIComponent(location)}` : "/api/energy";
  const { data, error, isLoading } = useSWR<ApiResponse>(apiUrl, fetcher, {
    // REMOVED refreshInterval to prevent memory leaks
    dedupingInterval: 5000,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  if (error) return <p className="text-red-400">Failed to load energy data.</p>;
  if (isLoading || !data) return <p className="text-gray-400 animate-pulse">Loading grid data…</p>;

  const { snapshot, historical } = data;

  return (
    <div className="space-y-8">


      <p className="text-xs text-gray-600">
        Last updated: {new Date(snapshot.timestamp).toLocaleString()} · Data sources: placeholder
      </p>
    </div>
  );
}
