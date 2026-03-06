"use client";

import HourlyMixChart from "@/components/HourlyMixChart";
import { useState, useEffect } from "react";
import useSWR, { SWRConfig } from "swr";
import { swrConfig } from "@/lib/swrConfig";

// Move fetcher outside component to prevent recreation
const fetcher = (url: string) => fetch(url).then((r) => r.json());

// Get yesterday's date in YYYY-MM-DD format
function getYesterday(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split('T')[0];
}

export default function Home() {
  const [location, setLocation] = useState<string>("NYISO");
  const [date, setDate] = useState(getYesterday());
  const [queryKey, setQueryKey] = useState<string | null>(null);

  const handleUpdate = () => {
    setQueryKey(`/api/energy?date=${date}${location ? `&location=${location}` : ''}`);
  };

  // Load data on initial mount
  useEffect(() => {
    handleUpdate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: hourlyData, isLoading: isLoadingHourly } = useSWR(
    queryKey,
    fetcher,
    {
      // Prevent memory leaks
      dedupingInterval: 5000,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
    }
  );

  return (
    <SWRConfig value={swrConfig}>
    <main className="min-h-screen p-6 md:p-10">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label htmlFor="date-picker" className="block text-sm font-medium text-gray-300 mb-2">
            Date:
          </label>
          <input
            type="date"
            id="date-picker"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="bg-white/10 border border-white/20 rounded-md px-3 py-2"
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label htmlFor="location" className="block text-sm font-medium text-gray-300 mb-2">
            Location:
          </label>
          <input
            id="location"
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value.toUpperCase())}
            placeholder="e.g., NYISO, CAISO, PJM"
            className="bg-white/10 border border-white/20 rounded-md px-3 py-2 w-full"
          />
        </div>
        <button
          onClick={handleUpdate}
          className="bg-sky-600 hover:bg-sky-500 rounded-md px-6 py-2 font-semibold transition-colors h-[42px]"
        >
          Update
        </button>
      </div>

      <div className="mt-8">
        {isLoadingHourly && <div className="text-center p-8">Loading hourly data...</div>}
        {hourlyData && (
          <>
            <HourlyMixChart data={hourlyData.hourly} />
            {hourlyData.meta && (
              <div className="text-xs text-gray-500 mt-4 text-center">
                Data source:{" "}
                <a
                  href={hourlyData.meta.source === 'grid-status' ? 'https://www.gridstatus.io' : 'https://www.eia.gov'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-sky-500 hover:text-sky-400 underline"
                >
                  {hourlyData.meta.source === 'grid-status' ? 'Grid Status' : 'EIA'}
                </a>
                {" • "}
                {hourlyData.meta.location} • {hourlyData.meta.date}
              </div>
            )}
          </>
        )}
      </div>
    </main>
    </SWRConfig>
  );
}
