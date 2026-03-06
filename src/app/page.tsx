"use client";

import CombinedChart from "@/components/CombinedChart";
import { useState, useEffect } from "react";
import useSWR, { SWRConfig } from "swr";
import { swrConfig } from "@/lib/swrConfig";

// Fetcher with timeout for client-side requests
const fetcher = async (url: string) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 65000); // 65 second timeout (slightly more than server timeout)
  
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }
    
    return response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error('Request timeout - data source may be slow or unavailable');
      }
      throw error;
    }
    throw new Error('Unknown error fetching data');
  }
};

// Get yesterday's date in YYYY-MM-DD format
function getYesterday(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split("T")[0];
}

export default function Home() {
  const [location, setLocation] = useState<string>("NYISO");
  const [date, setDate] = useState(getYesterday());
  const [node, setNode] = useState<string>("CAPITL");
  const [address, setAddress] = useState<string>("");
  const [isLocating, setIsLocating] = useState(false);
  const [geocodeMessage, setGeocodeMessage] = useState<string>("");
  const [fuelMixKey, setFuelMixKey] = useState<string | null>(null);
  const [pricingKey, setPricingKey] = useState<string | null>(null);
  const [isDateEditing, setIsDateEditing] = useState(false);
  const [isAddressEditing, setIsAddressEditing] = useState(false);
  const [fuelMixRetryCount, setFuelMixRetryCount] = useState(0);
  const [pricingRetryCount, setPricingRetryCount] = useState(0);

  const handleLocate = async () => {
    setIsLocating(true);
    setGeocodeMessage("");

    try {
      const response = await fetch(
        `/api/geocode?address=${encodeURIComponent(address)}`
      );
      const data = await response.json();

      if (!response.ok) {
        setGeocodeMessage(data.error || "Failed to geocode address");
        return;
      }

      if (data.iso) {
        setLocation(data.iso);
        // Always update node from geocode result
        if (data.suggestedNode) {
          setNode(data.suggestedNode);
        } else if (data.zone) {
          setNode(data.zone);
        }
        setGeocodeMessage(
          `Found: ${data.display_name} → ${data.iso}${data.zone ? ` (${data.zone})` : ""}`
        );
        console.log("Geocode result:", { iso: data.iso, zone: data.zone, suggestedNode: data.suggestedNode });
      } else if (data.message && data.message !== "No address provided") {
        setGeocodeMessage(data.message);
      }
    } catch (error) {
      setGeocodeMessage("Error locating address");
      console.error("Geocode error:", error);
    } finally {
      setIsLocating(false);
    }
  };

  const handleUpdate = () => {
    // Fetch fuel mix data
    setFuelMixKey(
      `/api/energy?date=${date}${location ? `&location=${location}` : ""}`
    );
    // Fetch pricing data
    setPricingKey(
      `/api/energy?date=${date}&location=${location}&view=pricing&node=${node}`
    );
    // Reset retry counts when manually updating
    setFuelMixRetryCount(0);
    setPricingRetryCount(0);
  };

  const handleDateSubmit = () => {
    setIsDateEditing(false);
    setFuelMixRetryCount(0);
    setPricingRetryCount(0);
    handleUpdate();
  };

  const handleAddressSubmit = async () => {
    setIsLocating(true);
    await handleLocate();
    setFuelMixRetryCount(0);
    setPricingRetryCount(0);
    handleUpdate();
    setIsLocating(false);
    setIsAddressEditing(false);
  };

  // Load data on initial mount
  useEffect(() => {
    handleUpdate();
    // Auto-populate address based on browser location
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude } = position.coords;
          try {
            // Use Nominatim reverse geocoding to get address
            const response = await fetch(
              `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`
            );
            const data = await response.json();
            
            // Create a readable address from the result
            const city = data.address.city || data.address.town || data.address.village || "";
            const county = data.address.county || "";
            const state = data.address.state || "";
            
            const autoAddress = [city, county, state].filter(Boolean).join(", ");
            if (autoAddress) {
              setAddress(autoAddress);
              
              // Also call our geocode API to get ISO and node
              try {
                const geocodeResponse = await fetch(
                  `/api/geocode?address=${encodeURIComponent(autoAddress)}`
                );
                const geocodeData = await geocodeResponse.json();
                
                if (geocodeData.iso) {
                  setLocation(geocodeData.iso);
                  // Update node from geocode result
                  if (geocodeData.suggestedNode) {
                    setNode(geocodeData.suggestedNode);
                  } else if (geocodeData.zone) {
                    setNode(geocodeData.zone);
                  }
                  setGeocodeMessage(
                    `Auto-detected: ${geocodeData.display_name} → ${geocodeData.iso}${geocodeData.zone ? ` (${geocodeData.zone})` : ""}`
                  );
                  // Refresh data with new location/node
                  setTimeout(() => handleUpdate(), 100);
                }
              } catch (error) {
                console.error("Error auto-populating ISO/Node:", error);
              }
            }
          } catch (error) {
            console.error("Error getting location address:", error);
          }
        },
        (error) => {
          console.log("Geolocation permission denied or unavailable:", error);
        }
      );
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: fuelMixData, isLoading: fuelMixLoading, error: fuelMixError } = useSWR(fuelMixKey, fetcher, {
    dedupingInterval: 5000,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    shouldRetryOnError: false,
  });

  const { data: pricingData, isLoading: pricingLoading, error: pricingError } = useSWR(pricingKey, fetcher, {
    dedupingInterval: 5000,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    shouldRetryOnError: false,
  });

  // Retry logic for fuel mix data with exponential backoff
  useEffect(() => {
    if (fuelMixError && !fuelMixData && fuelMixRetryCount < 3) {
      // Check if it's a rate limit error
      const isRateLimited = fuelMixError.message?.includes('Rate limit');
      // For rate limits, use longer delays: 15s, 30s, 60s
      // For other errors, use exponential backoff: 2s, 4s, 8s
      const baseDelay = isRateLimited ? 15000 : 2000;
      const delay = Math.pow(2, fuelMixRetryCount) * baseDelay;
      
      const retryTimer = setTimeout(() => {
        console.log(`Retrying fuel mix data (attempt ${fuelMixRetryCount + 1}/3 after ${delay}ms, rate limited: ${isRateLimited})...`);
        setFuelMixRetryCount(prev => prev + 1);
        // Force refetch by updating the key
        setFuelMixKey(
          `/api/energy?date=${date}${location ? `&location=${location}` : ""}&retry=${fuelMixRetryCount + 1}`
        );
      }, delay);

      return () => clearTimeout(retryTimer);
    }
  }, [fuelMixError, fuelMixData, fuelMixRetryCount, date, location]);

  // Retry logic for pricing data with exponential backoff
  useEffect(() => {
    if (pricingError && !pricingData && pricingRetryCount < 3) {
      // Check if it's a rate limit error
      const isRateLimited = pricingError.message?.includes('Rate limit');
      // For rate limits, use longer delays: 15s, 30s, 60s
      // For other errors, use exponential backoff: 2s, 4s, 8s
      const baseDelay = isRateLimited ? 15000 : 2000;
      const delay = Math.pow(2, pricingRetryCount) * baseDelay;
      
      const retryTimer = setTimeout(() => {
        console.log(`Retrying pricing data (attempt ${pricingRetryCount + 1}/3 after ${delay}ms, rate limited: ${isRateLimited})...`);
        setPricingRetryCount(prev => prev + 1);
        // Force refetch by updating the key
        setPricingKey(
          `/api/energy?date=${date}&location=${location}&view=pricing&node=${node}&retry=${pricingRetryCount + 1}`
        );
      }, delay);

      return () => clearTimeout(retryTimer);
    }
  }, [pricingError, pricingData, pricingRetryCount, date, location, node]);

  // Reset retry counts when data successfully loads
  useEffect(() => {
    if (fuelMixData && fuelMixRetryCount > 0) {
      console.log("Fuel mix data loaded successfully after retries");
      setFuelMixRetryCount(0);
    }
  }, [fuelMixData, fuelMixRetryCount]);

  useEffect(() => {
    if (pricingData && pricingRetryCount > 0) {
      console.log("Pricing data loaded successfully after retries");
      setPricingRetryCount(0);
    }
  }, [pricingData, pricingRetryCount]);

  // Pricing is now the primary data source, fuel mix is secondary/enhancement
  const hasPricingData = !!pricingData;
  const hasFuelMixData = !!fuelMixData;
  const hasAnyData = hasPricingData; // Chart requires pricing data as primary

  return (
    <SWRConfig value={swrConfig}>
      <main className="min-h-screen p-6 md:p-10">
        {/* Date and Address Fields - Inline Edit Style */}
        <div className="mb-8 flex flex-wrap gap-6 items-center">
          {/* Brand */}
          <div className="font-bold text-2xl text-gray-900">mixfix</div>
          
          {/* Date Field */}
          <div className="relative inline-flex items-center border border-transparent rounded-lg px-3" style={{ borderColor: isDateEditing ? '#5db4c8' : 'transparent', height: '38px' }}>
            {isDateEditing ? (
              <>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleDateSubmit();
                    }
                  }}
                  className="text-gray-800 font-medium focus:outline-none bg-transparent"
                  style={{ height: '26px' }}
                  autoFocus
                />
                <button
                  onClick={handleDateSubmit}
                  className="text-gray-500 hover:text-teal-600 transition-colors flex-shrink-0 ml-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </>
            ) : (
              <>
                <span className="text-gray-800 font-medium" style={{ lineHeight: '26px' }}>
                  {new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
                <button
                  onClick={() => setIsDateEditing(true)}
                  className="text-gray-500 hover:text-teal-600 transition-colors flex-shrink-0 ml-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
              </>
            )}
          </div>

          {/* Address Field */}
          <div className="flex-1 min-w-[300px] relative">
            <div className="relative inline-flex items-center w-full border border-transparent rounded-lg px-3" style={{ borderColor: isAddressEditing ? '#5db4c8' : 'transparent', height: '38px' }}>
              {isAddressEditing ? (
                <>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleAddressSubmit();
                      }
                    }}
                    placeholder="City, County, State"
                    className="text-gray-800 font-medium focus:outline-none bg-transparent flex-1 placeholder-gray-400"
                    style={{ height: '26px' }}
                    autoFocus
                  />
                  <button
                    onClick={handleAddressSubmit}
                    disabled={isLocating}
                    className="text-gray-500 hover:text-teal-600 transition-colors disabled:opacity-50 flex-shrink-0 ml-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </>
              ) : (
                <>
                  <span 
                    className={`font-medium cursor-pointer ${address ? 'text-gray-800' : 'text-gray-400'}`}
                    onClick={() => setIsAddressEditing(true)}
                    style={{ lineHeight: '26px' }}
                  >
                    {address || 'City, County, State'}
                  </span>
                  <button
                    onClick={() => setIsAddressEditing(true)}
                    className="text-gray-500 hover:text-teal-600 transition-colors flex-shrink-0 ml-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                </>
              )}
            </div>
            {geocodeMessage && (
              <p className="absolute left-0 top-full mt-1 text-xs text-gray-600 whitespace-nowrap">{geocodeMessage}</p>
            )}
          </div>
        </div>

        {/* ISO/Node Form Controls */}
        <div className="flex flex-wrap gap-3 items-end mb-6">
          <div className="flex-1 min-w-[200px]">
            <label
              htmlFor="location"
              className="block text-sm font-semibold text-gray-700 mb-2"
            >
              Operating Region (ISO/RTO BA):
            </label>
            <input
              id="location"
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value.toUpperCase())}
              placeholder="e.g., NYISO, CAISO, PJM"
              className="bg-white border border-gray-300 rounded-lg px-4 py-2.5 w-full focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent text-gray-800 placeholder-gray-400"
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label
              htmlFor="node"
              className="block text-sm font-semibold text-gray-700 mb-2"
            >
              Node:
            </label>
            <input
              id="node"
              type="text"
              value={node}
              onChange={(e) => setNode(e.target.value.toUpperCase())}
              placeholder="e.g., CAPITL, CENTRL"
              className="bg-white border border-gray-300 rounded-lg px-4 py-2.5 w-full focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent text-gray-800 placeholder-gray-400"
            />
          </div>
        </div>

        {/* Data Display */}
        <div className="mt-8">
          {/* Loading state only when we have NO data at all */}
          {!hasAnyData && pricingLoading && (
            <div className="text-center p-8 text-gray-600 font-medium">
              ⏳ Loading Pricing Data...
              <div className="text-sm mt-2 text-gray-500">Fetching from Grid Status API{pricingRetryCount > 0 && ` (Retry ${pricingRetryCount}/3)`}...</div>
              {fuelMixLoading && <div className="text-sm mt-2 text-gray-400">Also loading fuel mix data...</div>}
            </div>
          )}
          
          {/* Show critical error if pricing (primary data) fails */}
          {!pricingData && pricingError && (
            <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4 mb-4 shadow-sm">
              <p className="text-red-800 font-semibold">
                {pricingError.message?.includes("Rate limit") ? "⏱️ Rate Limit Reached" : "❌ Pricing Data Failed"}
              </p>
              <p className="text-sm text-red-700 mt-1">
                {pricingError.message || "Unknown error"}
                {pricingError.message?.includes("timeout") && " (API timeout - Grid Status may be slow)"}
                {pricingError.message?.includes("Rate limit") && " Automatic retry in progress with extended delays."}
                {pricingRetryCount > 0 && ` - Attempted ${pricingRetryCount} retries`}
              </p>
              <p className="text-sm text-red-600 mt-2 font-medium">Cannot display chart without pricing data.</p>
            </div>
          )}
          
          {/* Show fuel mix status as secondary/enhancement data */}
          {hasPricingData && !hasFuelMixData && fuelMixLoading && (
            <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4 mb-4 shadow-sm">
              <p className="text-blue-800 font-semibold">⏳ Loading Fuel Mix Data...</p>
              <p className="text-sm text-blue-700 mt-1">
                Fetching fuel generation mix{fuelMixRetryCount > 0 && ` (Retry ${fuelMixRetryCount}/3)`}...
              </p>
              <p className="text-sm text-blue-600 mt-1">Pricing data loaded. Chart showing pricing only.</p>
            </div>
          )}
          
          {hasPricingData && !hasFuelMixData && fuelMixError && (
            <div className="bg-amber-50 border-2 border-amber-200 rounded-lg p-4 mb-4 shadow-sm">
              <p className="text-amber-800 font-semibold">ℹ️ Fuel Mix Data Unavailable</p>
              <p className="text-sm text-amber-700 mt-1">
                {fuelMixError.message || "Unknown error"}
                {fuelMixRetryCount > 0 && ` (Attempted ${fuelMixRetryCount} retries)`}
              </p>
              <p className="text-sm text-amber-600 mt-1">Showing pricing data only - fuel mix enhancement unavailable.</p>
            </div>
          )}
          
          {/* Render chart when pricing data (primary) is available */}
          {hasAnyData && (
            <>
              <CombinedChart 
                fuelMixData={fuelMixData?.hourly || []} 
                pricingData={pricingData?.lmp || []}
              />
              {(fuelMixData?.meta || pricingData?.meta) && (
                <div className="text-sm text-gray-600 mt-6 text-center bg-white/60 rounded-lg py-3">
                  Data source:{" "}
                  <a
                    href={
                      (fuelMixData?.meta?.source === "grid-status" || pricingData?.meta?.source === "grid-status")
                        ? "https://www.gridstatus.io"
                        : "https://www.eia.gov"
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-teal-600 hover:text-teal-700 underline"
                  >
                    {(fuelMixData?.meta?.source === "grid-status" || pricingData?.meta?.source === "grid-status")
                      ? "Grid Status"
                      : "EIA"}
                  </a>
                  {" • "}
                  {fuelMixData?.meta?.location || pricingData?.meta?.location}
                  {pricingData?.meta?.node && ` • ${pricingData.meta.node}`} •{" "}
                  {fuelMixData?.meta?.date || pricingData?.meta?.date}
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </SWRConfig>
  );
}
