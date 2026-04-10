"use client";

import CombinedChart from "@/components/CombinedChart";
import Message from "@/components/Message";
import ThemeSwitcher from "../components/ThemeSwitcher";
import dynamic from "next/dynamic";
import { useState, useEffect, useRef } from "react";
import useSWR, { SWRConfig } from "swr";
import { swrConfig } from "@/lib/swrConfig";
import { hasPricingData, getBAConfig, getZoneName } from "@/lib/config/balancing-authorities";

const BAMap = dynamic(() => import("@/components/BAMap"), { ssr: false });

// Fetcher with timeout for client-side requests
const fetcher = async (url: string) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 65000); // 65 second timeout (slightly more than server timeout)
  
  // Enable debug logging with ?debug=true query param
  const isDebug = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug');
  
  if (isDebug) {
    console.log(`[Frontend Fetch] Request: ${url}`);
  }
  
  try {
    const fetchStart = Date.now();
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }
    
    const data = await response.json();
    const fetchTime = Date.now() - fetchStart;
    
    if (isDebug) {
      console.log(`[Frontend Fetch] Response received in ${fetchTime}ms`);
      
      // Log metadata
      if (data.meta) {
        console.log(`[Frontend Fetch] Metadata:`, {
          dataSource: data.meta.dataSource,
          source: data.meta.source,
          location: data.meta.location,
          date: data.meta.date,
          recordCount: data.meta.recordCount,
          timestamp: data.meta.timestamp,
          quality: data.quality?.confidence
        });
      }
      
      // Log data fingerprint for consistency checking
      if (data.hourly && data.hourly.length > 0) {
        const first = data.hourly[0];
        const last = data.hourly[data.hourly.length - 1];
        const totalGeneration = data.hourly.reduce((sum: number, record: any) => {
          const recordTotal = Object.entries(record)
            .filter(([key]) => key !== 'date')
            .reduce((acc, [, val]) => acc + (typeof val === 'number' ? val : 0), 0);
          return sum + recordTotal;
        }, 0);
        
        console.log(`[Frontend Fetch] Data fingerprint:`, {
          records: data.hourly.length,
          firstHour: first.date,
          lastHour: last.date,
          totalGeneration: Math.round(totalGeneration * 100) / 100,
          firstHourSample: { date: first.date, coal: first.coal, gas: first.gas, nuclear: first.nuclear }
        });
      }
      
      if (data.lmp && data.lmp.length > 0) {
        const avgPrice = data.lmp.reduce((sum: number, point: any) => sum + point.lmp, 0) / data.lmp.length;
        console.log(`[Frontend Fetch] Pricing fingerprint:`, {
          points: data.lmp.length,
          avgPrice: Math.round(avgPrice * 100) / 100,
          range: [Math.min(...data.lmp.map((p: any) => p.lmp)), Math.max(...data.lmp.map((p: any) => p.lmp))]
        });
      }
    }
    
    return data;
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

// Get two days ago in YYYY-MM-DD format (to ensure complete data availability)
// EIA data has a delay, so yesterday might not have complete data yet
function getTwoDaysAgo(): string {
  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  const year = twoDaysAgo.getFullYear();
  const month = String(twoDaysAgo.getMonth() + 1).padStart(2, '0');
  const day = String(twoDaysAgo.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Get today's date in YYYY-MM-DD format (for max date input)
function getToday(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function Home() {
  const [balancingAuthority, setBalancingAuthority] = useState<string>("");
  const [date, setDate] = useState(getTwoDaysAgo());
  const [zone, setZone] = useState<string>("");
  const [address, setAddress] = useState<string>("");
  const [isLocating, setIsLocating] = useState(false);

  const [dateFocused, setDateFocused] = useState(false);
  const [dateHovered, setDateHovered] = useState(false);
  const [addressFocused, setAddressFocused] = useState(false);
  const [addressHovered, setAddressHovered] = useState(false);
  const [fuelMixRetryCount, setFuelMixRetryCount] = useState(0);
  const [pricingRetryCount, setPricingRetryCount] = useState(0);
  const [gridStatusQuotaExceeded, setGridStatusQuotaExceeded] = useState(false);
  const [showMapPanel, setShowMapPanel] = useState(false);
  
  // Derive SWR keys reactively from state - ensures chart always syncs with BA/Zone fields
  const fuelMixKey = balancingAuthority 
    ? `/api/energy?date=${date}&location=${balancingAuthority}${fuelMixRetryCount > 0 ? `&retry=${fuelMixRetryCount}` : ""}`
    : null;

  const pricingKey = (balancingAuthority && zone && hasPricingData(balancingAuthority))
    ? `/api/energy?date=${date}&location=${balancingAuthority}&view=pricing&node=${zone}${pricingRetryCount > 0 ? `&retry=${pricingRetryCount}` : ""}`
    : null;
  
  const dateInputRef = useRef<HTMLInputElement>(null);
  const addressInputRef = useRef<HTMLInputElement>(null);

  const handleLocate = async () => {
    setIsLocating(true);

    try {
      const response = await fetch(
        `/api/geocode?address=${encodeURIComponent(address)}`
      );
      const data = await response.json();

      if (!response.ok) {
        // Reset BA/Zone when geocoding fails (e.g., address not found).
        setBalancingAuthority("");
        setZone("");
        return;
      }

      if (data.iso) {
        setBalancingAuthority(data.iso);
        // Always update zone from geocode result
        if (data.suggestedNode) {
          setZone(data.suggestedNode);
        } else if (data.zone) {
          setZone(data.zone);
        }
        console.log("Geocode result:", { iso: data.iso, zone: data.zone, suggestedNode: data.suggestedNode });
      } else {
        // No BA/Zone found - reset fields and show error in Location field
        setAddress("BA/Zone not found");
        setBalancingAuthority("");
        setZone("");
      }
    } catch (error) {
      setBalancingAuthority("");
      setZone("");
      console.error("Geocode error:", error);
    } finally {
      setIsLocating(false);
    }
  };

  const handleAddressChange = async () => {
    if (!address.trim()) return;
    setIsLocating(true);
    await handleLocate();
    setFuelMixRetryCount(0);
    setPricingRetryCount(0);
    setIsLocating(false);
  };

  // Load data on initial mount
  useEffect(() => {
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
            
            const autoAddress = city;
            if (autoAddress) {
              setAddress(autoAddress);
              
              // Also call our geocode API to get ISO and node
              try {
                const geocodeResponse = await fetch(
                  `/api/geocode?address=${encodeURIComponent(autoAddress)}`
                );
                const geocodeData = await geocodeResponse.json();
                
                if (geocodeData.iso) {
                  setBalancingAuthority(geocodeData.iso);
                  // Update zone from geocode result
                  if (geocodeData.suggestedNode) {
                    setZone(geocodeData.suggestedNode);
                  } else if (geocodeData.zone) {
                    setZone(geocodeData.zone);
                  }

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

  // Check for Grid Status quota exceeded in pricing error
  useEffect(() => {
    if (pricingError?.message?.includes("quota exceeded") || pricingError?.message?.includes("limit reached")) {
      setGridStatusQuotaExceeded(true);
    }
  }, [pricingError]);

  // Retry logic for fuel mix data with exponential backoff
  useEffect(() => {
    if (fuelMixError && !fuelMixData && fuelMixRetryCount < 3) {
      // Don't retry if it's a rate limit or quota error - these won't be fixed by retrying
      const isRateOrQuotaLimit = fuelMixError.message?.includes('rate limit') || 
                                 fuelMixError.message?.includes('Rate limit') ||
                                 fuelMixError.message?.includes('quota exceeded');
      
      if (isRateOrQuotaLimit) {
        console.log('Skipping retry for EIA rate/quota limit error');
        return;
      }
      
      // For other errors, use exponential backoff: 2s, 4s, 8s
      const delay = Math.pow(2, fuelMixRetryCount) * 2000;
      
      const retryTimer = setTimeout(() => {
        console.log(`Retrying fuel mix data (attempt ${fuelMixRetryCount + 1}/3 after ${delay}ms)...`);
        setFuelMixRetryCount(prev => prev + 1);
      }, delay);

      return () => clearTimeout(retryTimer);
    }
  }, [fuelMixError, fuelMixData, fuelMixRetryCount, date, balancingAuthority]);

  // Retry logic for pricing data with exponential backoff
  useEffect(() => {
    if (pricingError && !pricingData && pricingRetryCount < 3) {
      // Don't retry if it's a rate limit or quota error - these won't be fixed by retrying
      const isRateOrQuotaLimit = pricingError.message?.includes('rate limit') || 
                                 pricingError.message?.includes('Rate limit') ||
                                 pricingError.message?.includes('quota exceeded') ||
                                 pricingError.message?.includes('limit reached');
      
      if (isRateOrQuotaLimit) {
        console.log('Skipping retry for Grid Status rate/quota limit error');
        return;
      }
      
      // For other errors, use exponential backoff: 2s, 4s, 8s
      const delay = Math.pow(2, pricingRetryCount) * 2000;
      
      const retryTimer = setTimeout(() => {
        console.log(`Retrying pricing data (attempt ${pricingRetryCount + 1}/3 after ${delay}ms)...`);
        setPricingRetryCount(prev => prev + 1);
      }, delay);

      return () => clearTimeout(retryTimer);
    }
  }, [pricingError, pricingData, pricingRetryCount, date, balancingAuthority, zone]);

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

  // Check if current BA supports pricing
  const supportsPricing = hasPricingData(balancingAuthority);
  // Data availability - show chart if we have either pricing or fuel mix data
  const hasPricingDataLoaded = !!pricingData;
  const hasFuelMixData = !!fuelMixData;
  const hasAnyData = hasPricingDataLoaded || hasFuelMixData; // Show chart with any available data

  const displayPricingData = pricingData?.lmp;

  const statusMessageNode = (() => {
    const messages: React.ReactNode[] = [];
    let hasError = false;

    // Non-ISO BA info
    if (!supportsPricing && balancingAuthority) {
      messages.push(`Pricing unavailable for ${balancingAuthority}; showing fuel mix only`);
    }

    // No BA selected
    if (!balancingAuthority) {
      messages.push("Select a BA and zone to load data");
    }

    // Loading state
    if (!hasAnyData && (supportsPricing ? pricingLoading : fuelMixLoading)) {
      messages.push(
        `Loading ${supportsPricing ? "pricing" : "fuel mix"}${
          (supportsPricing ? pricingRetryCount : fuelMixRetryCount) > 0
            ? ` (Retry ${supportsPricing ? pricingRetryCount : fuelMixRetryCount}/3)`
            : ""
        }${supportsPricing && fuelMixLoading ? " and fuel mix" : ""}...`
      );
    }

    // Pricing error blocking chart
    if (supportsPricing && !pricingData && pricingError && !hasFuelMixData) {
      hasError = true;
      messages.push(
        (pricingError.message?.includes("quota exceeded") || pricingError.message?.includes("limit reached"))
          ? "Grid Status quota exceeded. Chart unavailable."
          : pricingError.message?.includes("Rate limit")
            ? `Pricing rate limited${pricingRetryCount > 0 ? ` after ${pricingRetryCount} retries` : ""}. Chart unavailable.`
            : `Pricing failed: ${pricingError.message || "Unknown error"}. Chart unavailable.`
      );
    }

    // Pricing error with fuel mix fallback
    if (supportsPricing && !pricingData && (pricingError || gridStatusQuotaExceeded) && hasFuelMixData) {
      hasError = true;
      messages.push(
        pricingError?.message?.includes("quota exceeded") || pricingError?.message?.includes("limit reached") || gridStatusQuotaExceeded
          ? "Pricing unavailable due to quota limits"
          : pricingError?.message?.includes("Rate limit")
            ? "Pricing temporarily unavailable (rate limit)"
            : "Pricing unavailable"
      );
    }

    // Fuel mix loading (secondary)
    if (supportsPricing && hasPricingDataLoaded && !hasFuelMixData && fuelMixLoading) {
      messages.push(`Loading fuel mix${fuelMixRetryCount > 0 ? ` (Retry ${fuelMixRetryCount}/3)` : ""}...`);
    }

    // Fuel mix error with pricing fallback
    if (supportsPricing && hasPricingDataLoaded && !hasFuelMixData && fuelMixError) {
      hasError = true;
      messages.push(
        (fuelMixError.message?.includes("rate limit") || fuelMixError.message?.includes("Rate limit"))
          ? "EIA rate limited. Showing pricing only."
          : `Fuel mix unavailable: ${fuelMixError.message || "Unknown error"}. Showing pricing only.`
      );
    }

    // Non-ISO fuel mix error
    if (!supportsPricing && balancingAuthority && !fuelMixData && fuelMixError) {
      hasError = true;
      messages.push(
        fuelMixError.message?.includes("rate limit") || fuelMixError.message?.includes("Rate limit")
          ? "EIA rate limited. Try again soon."
          : `Fuel mix failed: ${fuelMixError.message || "Unknown error"}`
      );
    }

    if (messages.length === 0) return null;

    return (
      <Message type={hasError ? "error" : "info"} className="mb-0">
        {messages.map((msg, i) => (
          <span key={i}>
            {i > 0 && " | "}
            {msg}
          </span>
        ))}
      </Message>
    );
  })();

  return (
    <>
    <SWRConfig value={swrConfig}>
      <main className="min-h-screen w-[80%] mx-auto" style={{ padding: 'clamp(1.5rem, 2vw, 4rem) clamp(1rem, 2vw, 3rem)' }}>
        {/* Top Row: Brand + Fields + Status */}
        <div className="flex flex-wrap gap-2 items-baseline form-fields-group">
          <div className="flex flex-col">
            <label className="font-semibold pr-2" style={{ color: 'transparent', fontSize: 'var(--font-form-xs)' }}>.</label>
            <div className="font-bold text-2xl mixfix-brand-title" style={{ color: 'var(--text-primary)', marginRight: '0.5rem', height: 'var(--form-height)', display: 'flex', alignItems: 'center' }}>mixfix</div>
          </div>

          {/* Date Field */}
          <div className="flex flex-col form-field-block">
            <label className="font-semibold pr-2" style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-form-xs)' }}>Date</label>
            <div className="flex items-center gap-0">
            <div 
              className="relative inline-flex items-center border rounded-lg pr-2 transition-all form-field-shell" 
              style={{ borderColor: (dateFocused || dateHovered) ? 'var(--active)' : 'var(--border-subtle)', height: 'var(--form-height)', paddingLeft: '3px' }}
              onMouseEnter={() => setDateHovered(true)}
              onMouseLeave={() => setDateHovered(false)}
            >
              <input
                ref={dateInputRef}
                type="date"
                value={date}
                max={getToday()}
                onChange={(e) => setDate(e.target.value)}
                onFocus={(e) => {
                  setDateFocused(true);
                  e.target.select();
                  e.target.showPicker?.();
                }}
                onBlur={() => {
                  setDateFocused(false);
                  setFuelMixRetryCount(0);
                  setPricingRetryCount(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                  }
                }}
                className="font-medium focus:outline-none bg-transparent"
                style={{ color: 'var(--text-primary)', height: 'var(--input-height)', fontSize: 'var(--font-form-base)', fieldSizing: 'content' }}
              />
            </div>
            </div>
          </div>

          {/* Address Field */}
          <div className="flex flex-col form-field-block">
            <label className="font-semibold pr-2" style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-form-xs)' }}>Location</label>
            <div className="relative">
            <div className="flex items-center gap-0">
              <div 
                className="relative inline-flex items-center border rounded-lg pr-2 transition-all form-field-shell" 
                style={{ borderColor: (addressFocused || addressHovered) ? 'var(--active)' : 'var(--border-subtle)', height: 'var(--form-height)', paddingLeft: '3px' }}
                onMouseEnter={() => setAddressHovered(true)}
                onMouseLeave={() => setAddressHovered(false)}
              >
                <input
                  ref={addressInputRef}
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  onFocus={(e) => {
                    setAddressFocused(true);
                    e.target.select();
                  }}
                  onBlur={() => {
                    setAddressFocused(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleAddressChange();
                      e.currentTarget.blur();
                    }
                  }}
                  placeholder="City, County, State"
                  className="font-medium focus:outline-none bg-transparent"
                  style={{ color: 'var(--text-primary)', height: 'var(--input-height)', fontSize: 'var(--font-form-base)', fieldSizing: 'content' }}
                />
                <button
                  type="button"
                  onMouseDown={(e) => {
                    // Keep focus stable through click so the button doesn't disable itself before onClick fires.
                    e.preventDefault();
                  }}
                  onClick={() => {
                    handleAddressChange();
                    addressInputRef.current?.blur();
                  }}
                  className="ml-2 hover:opacity-70 transition-opacity"
                  style={{
                    color: 'var(--interactive-primary)',
                    fontSize: 'var(--font-form-base)',
                    opacity: (addressFocused && address) ? 1 : 0,
                    pointerEvents: (addressFocused && address) ? 'auto' : 'none',
                    visibility: (addressFocused && address) ? 'visible' : 'hidden'
                  }}
                  title="Geocode location"
                  tabIndex={-1}
                >
                  →
                </button>
              </div>
            </div>
            </div>
          </div>

          {/* Grid Info Button */}
          <div className="flex flex-col form-field-block">
            <label className="font-semibold pr-2" style={{ color: 'transparent', fontSize: 'var(--font-form-xs)' }}>.</label>
            <button
              type="button"
              onClick={() => setShowMapPanel((prev) => !prev)}
              onMouseEnter={(e) => { if (!showMapPanel) e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'; }}
              onMouseLeave={(e) => { if (!showMapPanel) e.currentTarget.style.backgroundColor = 'var(--bg-primary)'; }}
              className="px-3 py-1.5 font-medium rounded-lg transition-colors"
              style={{
                backgroundColor: showMapPanel ? "var(--active)" : "var(--bg-primary)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-subtle)",
                height: 'var(--form-height)',
                fontSize: 'var(--font-form-base)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="3,6 9,3 15,6 21,3 21,18 15,21 9,18 3,21"/>
                <line x1="9" y1="3" x2="9" y2="18"/>
                <line x1="15" y1="6" x2="15" y2="21"/>
              </svg>
              Grid Info
            </button>
          </div>

          {/* Status message */}
          <div className="flex-1 min-w-[260px] self-end" style={{ paddingBottom: '2px' }}>
            {statusMessageNode}
          </div>

        </div>{/* End Top Row */}

        {/* Grid / Zone summary line */}
        {balancingAuthority && (
          <div className="mt-1 text-sm">
            Fuel mix in the{' '}
            <span>{getBAConfig(balancingAuthority)?.name || balancingAuthority}</span>
            {' '}BA
            {supportsPricing && zone && (
              <>, Pricing in{' '}
                <span>{getZoneName(balancingAuthority, zone) || zone}</span>
                {' '}Zone
              </>
            )}
            .
          </div>
        )}

        {/* Data Display */}
        <div className="mt-4 data-display-container">
          {/* Loading animation while waiting for data */}
          {!hasAnyData && (
            <div className="flex items-center justify-center" style={{ minHeight: '400px' }}>
              <video
                src="/images/bolt.webm"
                autoPlay
                loop
                muted
                playsInline
                style={{ width: '120px', height: '120px' }}
              />
            </div>
          )}
          {/* Render chart when any data is available */}
          {hasAnyData && (
            <>
              <CombinedChart 
                fuelMixData={fuelMixData?.hourly || []} 
                pricingData={displayPricingData || []}
                balancingAuthority={balancingAuthority}
                baName={balancingAuthority}
                zoneName={zone}
              />
              {(fuelMixData?.meta || pricingData?.meta) && (
                <div className="text-sm text-left space-y-1 data-sources-footer" style={{ color: 'var(--text-secondary)' }}>
                  <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>Data Sources:</div>
                  
                  {/* EIA API - Fuel Mix */}
                  {fuelMixData?.meta && (
                    <div className="flex flex-wrap items-center gap-x-2">
                      <a
                        href="https://www.eia.gov/opendata/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold underline"
                        style={{ color: 'var(--interactive-primary)' }}
                      >
                        EIA API v2
                      </a>
                      <span>→</span>
                      <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                        {fuelMixData.meta.location}
                      </span>
                      <span>→</span>
                      <span>Hourly fuel mix generation data</span>
                      <span style={{ color: 'var(--text-tertiary)' }}>
                        {fuelMixData.meta.cached
                          ? fuelMixData.meta.cacheComplete
                            ? '(cached)'
                            : `(cached, ${fuelMixData.meta.hours} of 25 hours)`
                          : fuelMixData.meta.cacheComplete
                            ? '(live)'
                            : `(live, ${fuelMixData.meta.hours} of 25 hours)`
                        }
                      </span>
                    </div>
                  )}
                  
                  {/* Grid Status API - Pricing */}
                  {pricingData?.meta && (
                    <div className="flex flex-wrap items-center gap-x-2">
                      <a
                        href="https://www.gridstatus.io"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold underline"
                        style={{ color: 'var(--interactive-primary)' }}
                      >
                        Grid Status API
                      </a>
                      <span>→</span>
                      <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                        {pricingData.meta.location}
                        {pricingData.meta.node && ` / Zone: ${pricingData.meta.node}`}
                      </span>
                      <span>→</span>
                      <span>Locational Marginal Price (LMP = Energy + Congestion + Loss)</span>
                      <span style={{ color: 'var(--text-tertiary)' }}>
                        {pricingData.meta.cached
                          ? pricingData.meta.cacheComplete
                            ? '(cached)'
                            : `(cached, ${pricingData.meta.hours} of 25 hours)`
                          : pricingData.meta.cacheComplete
                            ? '(live)'
                            : `(live, ${pricingData.meta.hours} of 25 hours)`
                        }
                      </span>
                    </div>
                  )}
                  
                  <div className="pt-1">
                    <ThemeSwitcher />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
      
      {/* Portrait-only footer branding */}
      <div className="portrait-footer-brand max-w-[1080px] w-full mx-auto">
        <div className="font-bold text-2xl" style={{ color: 'var(--text-primary)' }}>mixfix</div>
      </div>

      <BAMap
        isOpen={showMapPanel}
        onClose={() => setShowMapPanel(false)}
        balancingAuthority={balancingAuthority}
        zone={zone}
        onBalancingAuthorityChange={(code) => {
          setBalancingAuthority(code);
          setAddress('');
          setFuelMixRetryCount(0);
          setPricingRetryCount(0);
        }}
        onZoneChange={(code) => {
          setZone(code);
          setFuelMixRetryCount(0);
          setPricingRetryCount(0);
        }}
      />
    </SWRConfig>
    </>
  );
}
