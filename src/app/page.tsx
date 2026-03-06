"use client";

import HourlyMixChart from "@/components/HourlyMixChart";
import LMPChart from "@/components/LMPChart";
import { useState, useEffect } from "react";
import useSWR, { SWRConfig } from "swr";
import { swrConfig } from "@/lib/swrConfig";

// Move fetcher outside component to prevent recreation
const fetcher = (url: string) => fetch(url).then((r) => r.json());

// Get yesterday's date in YYYY-MM-DD format
function getYesterday(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split("T")[0];
}

export default function Home() {
  const [location, setLocation] = useState<string>("NYISO");
  const [date, setDate] = useState(getYesterday());
  const [view, setView] = useState<"fuel-mix" | "pricing">("fuel-mix");
  const [node, setNode] = useState<string>("CAPITL");
  const [queryKey, setQueryKey] = useState<string | null>(null);

  const handleUpdate = () => {
    if (view === "pricing") {
      setQueryKey(
        `/api/energy?date=${date}&location=${location}&view=pricing&node=${node}`
      );
    } else {
      setQueryKey(
        `/api/energy?date=${date}${location ? `&location=${location}` : ""}`
      );
    }
  };

  // Load data on initial mount
  useEffect(() => {
    handleUpdate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: apiData, isLoading } = useSWR(queryKey, fetcher, {
    // Prevent memory leaks
    dedupingInterval: 5000,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    shouldRetryOnError: false,
  });

  return (
    <SWRConfig value={swrConfig}>
      <main className="min-h-screen p-6 md:p-10">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">MixFix</h1>
          <p className="text-sm text-gray-400 mt-1">
            Electricity generation mix and pricing data
          </p>
        </header>

        {/* View Toggle */}
        <div className="mb-4">
          <div className="inline-flex rounded-lg bg-white/5 p-1">
            <button
              onClick={() => setView("fuel-mix")}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                view === "fuel-mix"
                  ? "bg-sky-600 text-white"
                  : "text-gray-300 hover:text-white"
              }`}
            >
              Fuel Mix
            </button>
            <button
              onClick={() => setView("pricing")}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                view === "pricing"
                  ? "bg-sky-600 text-white"
                  : "text-gray-300 hover:text-white"
              }`}
            >
              Pricing (LMP)
            </button>
          </div>
        </div>

        {/* Form Controls */}
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label
              htmlFor="date-picker"
              className="block text-sm font-medium text-gray-300 mb-2"
            >
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
            <label
              htmlFor="location"
              className="block text-sm font-medium text-gray-300 mb-2"
            >
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
          {view === "pricing" && (
            <div className="flex-1 min-w-[200px]">
              <label
                htmlFor="node"
                className="block text-sm font-medium text-gray-300 mb-2"
              >
                Node:
              </label>
              <input
                id="node"
                type="text"
                value={node}
                onChange={(e) => setNode(e.target.value.toUpperCase())}
                placeholder="e.g., CAPITL, CENTRL"
                className="bg-white/10 border border-white/20 rounded-md px-3 py-2 w-full"
              />
            </div>
          )}
          <button
            onClick={handleUpdate}
            className="bg-sky-600 hover:bg-sky-500 rounded-md px-6 py-2 font-semibold transition-colors h-[42px]"
          >
            Update
          </button>
        </div>

        {/* Data Display */}
        <div className="mt-8">
          {isLoading && (
            <div className="text-center p-8">Loading data...</div>
          )}
          {apiData && (
            <>
              {view === "fuel-mix" && apiData.hourly && (
                <HourlyMixChart data={apiData.hourly} />
              )}
              {view === "pricing" && apiData.lmp && (
                <LMPChart data={apiData.lmp} />
              )}
              {apiData.meta && (
                <div className="text-xs text-gray-500 mt-4 text-center">
                  Data source:{" "}
                  <a
                    href={
                      apiData.meta.source === "grid-status"
                        ? "https://www.gridstatus.io"
                        : "https://www.eia.gov"
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-sky-500 hover:text-sky-400 underline"
                  >
                    {apiData.meta.source === "grid-status"
                      ? "Grid Status"
                      : "EIA"}
                  </a>
                  {" • "}
                  {apiData.meta.location}
                  {apiData.meta.node && ` • ${apiData.meta.node}`} •{" "}
                  {apiData.meta.date}
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </SWRConfig>
  );
}
