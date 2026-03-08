"use client";

import CombinedChart from "@/components/CombinedChart";
import Message from "@/components/Message";
import { useState, useEffect, useRef } from "react";
import useSWR, { SWRConfig } from "swr";
import { swrConfig } from "@/lib/swrConfig";
import { getAllBAs, getZones, hasPricingData, getRepresentativeZone } from "@/lib/config/balancing-authorities";
import { LMPDataPoint } from "@/types/energy";

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
  // Load all available balancing authorities from config
  const allBAs = getAllBAs();
  
  const [location, setLocation] = useState<string>("");
  const [date, setDate] = useState(getTwoDaysAgo());
  const [zone, setZone] = useState<string>("");
  const [showBADropdown, setShowBADropdown] = useState(false);
  const [baSearchTerm, setBaSearchTerm] = useState("");
  const [showZoneDropdown, setShowZoneDropdown] = useState(false);
  const [zoneSearchTerm, setZoneSearchTerm] = useState("");
  const [address, setAddress] = useState<string>("");
  const [isLocating, setIsLocating] = useState(false);
  const [geocodeMessage, setGeocodeMessage] = useState<string>("");
  const [dateFocused, setDateFocused] = useState(false);
  const [dateHovered, setDateHovered] = useState(false);
  const [addressFocused, setAddressFocused] = useState(false);
  const [addressHovered, setAddressHovered] = useState(false);
  const [baFocused, setBaFocused] = useState(false);
  const [baHovered, setBaHovered] = useState(false);
  const [zoneFocused, setZoneFocused] = useState(false);
  const [zoneHovered, setZoneHovered] = useState(false);
  const [fuelMixRetryCount, setFuelMixRetryCount] = useState(0);
  const [pricingRetryCount, setPricingRetryCount] = useState(0);
  const [useMockPricing, setUseMockPricing] = useState(false);
  const [mockPricingData, setMockPricingData] = useState<LMPDataPoint[] | null>(null);
  const [gridStatusQuotaExceeded, setGridStatusQuotaExceeded] = useState(false);
  
  // Derive SWR keys reactively from state - ensures chart always syncs with BA/Zone fields
  const fuelMixKey = location 
    ? `/api/energy?date=${date}&location=${location}${fuelMixRetryCount > 0 ? `&retry=${fuelMixRetryCount}` : ""}`
    : null;

  const pricingKey = (location && zone && hasPricingData(location))
    ? `/api/energy?date=${date}&location=${location}&view=pricing&node=${zone}${pricingRetryCount > 0 ? `&retry=${pricingRetryCount}` : ""}`
    : null;
  
  const dateInputRef = useRef<HTMLInputElement>(null);
  const addressInputRef = useRef<HTMLInputElement>(null);
  const baInputRef = useRef<HTMLInputElement>(null);
  const zoneInputRef = useRef<HTMLInputElement>(null);

  // Generate mock pricing data for development/testing
  const generateMockPricingData = (date: string): LMPDataPoint[] => {
    const hours = Array.from({ length: 25 }, (_, i) => i); // 0-24 for 25-hour cycle
    return hours.map(hour => {
      // For hour 24, use the same date but hour 24 (matches EIA pattern)
      const timeStr = `${date}T${String(hour).padStart(2, '0')}:00:00`;
      
      // Simulate typical daily pricing pattern
      // Higher during peak hours (8am-8pm), lower at night
      const hourOfDay = hour % 24;
      const isPeak = hourOfDay >= 8 && hourOfDay <= 20;
      const baseLMP = isPeak ? 45 : 25;
      const variation = Math.random() * 20 - 10;
      
      const lmp = baseLMP + variation;
      const energy = lmp * 0.85; // Energy is typically ~85% of LMP
      const congestion = Math.random() * 5 - 2.5; // Small congestion component
      const loss = lmp - energy - congestion; // Loss is the remainder
      
      return {
        time: timeStr,
        lmp: Number(lmp.toFixed(2)),
        energy: Number(energy.toFixed(2)),
        congestion: Number(congestion.toFixed(2)),
        loss: Number(loss.toFixed(2)),
      };
    });
  };

  // Enable mock pricing data
  const handleEnableMockPricing = () => {
    const mockData = generateMockPricingData(date);
    setMockPricingData(mockData);
    setUseMockPricing(true);
  };

  // Update mock pricing data when date changes (but keep mock pricing enabled)
  useEffect(() => {
    if (useMockPricing) {
      const mockData = generateMockPricingData(date);
      setMockPricingData(mockData);
    }
  }, [date, useMockPricing]);

  const handleLocate = async () => {
    setIsLocating(true);
    setGeocodeMessage("");

    try {
      const response = await fetch(
        `/api/geocode?address=${encodeURIComponent(address)}`
      );
      const data = await response.json();

      if (!response.ok) {
        // Reset BA/Zone when geocoding fails (e.g., address not found).
        setLocation("");
        setZone("");
        setGeocodeMessage(data.error || "Failed to geocode address");
        return;
      }

      if (data.iso) {
        setLocation(data.iso);
        // Always update zone from geocode result
        if (data.suggestedNode) {
          setZone(data.suggestedNode);
        } else if (data.zone) {
          setZone(data.zone);
        }
        setGeocodeMessage(
          `Found: ${data.display_name} → ${data.iso}${data.zone ? ` (${data.zone})` : ""}`
        );
        console.log("Geocode result:", { iso: data.iso, zone: data.zone, suggestedNode: data.suggestedNode });
      } else {
        // No BA/Zone found - reset fields and show error in Location field
        setAddress("BA/Zone not found");
        setLocation("");
        setZone("");
        if (data.message && data.message !== "No address provided") {
          setGeocodeMessage(data.message);
        } else {
          setGeocodeMessage("Location not found or not within a balancing authority");
        }
      }
    } catch (error) {
      setLocation("");
      setZone("");
      setGeocodeMessage("Error locating address");
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
                  // Update zone from geocode result
                  if (geocodeData.suggestedNode) {
                    setZone(geocodeData.suggestedNode);
                  } else if (geocodeData.zone) {
                    setZone(geocodeData.zone);
                  }
                  setGeocodeMessage(
                    `Auto-detected: ${geocodeData.display_name} → ${geocodeData.iso}${geocodeData.zone ? ` (${geocodeData.zone})` : ""}`
                  );
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
  }, [fuelMixError, fuelMixData, fuelMixRetryCount, date, location]);

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
  }, [pricingError, pricingData, pricingRetryCount, date, location, zone]);

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
  const supportsPricing = hasPricingData(location);
  
  // Data availability - show chart if we have either pricing or fuel mix data
  const hasPricingDataLoaded = !!pricingData || useMockPricing;
  const hasFuelMixData = !!fuelMixData;
  const hasAnyData = hasPricingDataLoaded || hasFuelMixData; // Show chart with any available data

  // Use mock pricing data if enabled, otherwise use real data
  const displayPricingData = useMockPricing ? mockPricingData : pricingData?.lmp;

  return (
    <SWRConfig value={swrConfig}>
      <main className="min-h-screen p-6 md:p-10">
        {/* All Fields - Inline Edit Style */}
        <div className="mb-2 flex flex-wrap gap-6 items-baseline">
          {/* Brand */}
          <div className="flex flex-col">
            <div className="text-xs font-semibold px-3 invisible">_</div>
            <div className="font-bold text-2xl" style={{ color: 'var(--text-primary)' }}>mixfix</div>
          </div>
          
          {/* Date Field */}
          <div className="flex flex-col">
            <label className="text-xs font-semibold px-3" style={{ color: 'var(--text-secondary)' }}>Date</label>
            <div className="flex items-center gap-0">
            <div 
              className="relative inline-flex items-center border rounded-lg px-3 transition-all" 
              style={{ borderColor: (dateFocused || dateHovered) ? 'var(--active)' : 'transparent', height: '38px' }}
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
                style={{ color: 'var(--text-primary)', height: '26px', fieldSizing: 'content' }}
              />
            </div>
            </div>
          </div>

          {/* Address Field */}
          <div className="flex flex-col">
            <label className="text-xs font-semibold px-3" style={{ color: 'var(--text-secondary)' }}>Location</label>
            <div className="relative">
            <div className="flex items-center gap-0">
              <div 
                className="relative inline-flex items-center border rounded-lg px-3 transition-all" 
                style={{ borderColor: (addressFocused || addressHovered) ? 'var(--active)' : 'transparent', height: '38px' }}
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
                  style={{ color: 'var(--text-primary)', height: '26px', fieldSizing: 'content' }}
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
                    fontSize: '18px',
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

          {/* BA Field */}
          <div className="flex flex-col">
            <label className="text-xs font-semibold px-3" style={{ color: 'var(--text-secondary)' }}>BA</label>
            <div className="relative">
            <div className="flex items-center gap-0">
              <div 
                className="relative inline-flex items-center border rounded-lg px-3 transition-all" 
                style={{ borderColor: (baFocused || baHovered) ? 'var(--active)' : 'transparent', height: '38px' }}
                onMouseEnter={() => setBaHovered(true)}
                onMouseLeave={() => setBaHovered(false)}
              >
                {addressFocused ? (
                  <span className="pulse-dash font-medium select-none" style={{ color: 'var(--text-secondary)', height: '26px', minWidth: '80px' }}>--</span>
                ) : (
                  <input
                    ref={baInputRef}
                    type="text"
                    value={baSearchTerm || location}
                    onChange={(e) => {
                      setBaSearchTerm(e.target.value);
                      setShowBADropdown(true);
                    }}
                    onFocus={(e) => {
                      setBaFocused(true);
                      setShowBADropdown(true);
                      e.target.select();
                    }}
                    onBlur={() => {
                      setBaFocused(false);
                      setTimeout(() => setShowBADropdown(false), 200);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.currentTarget.blur();
                        setFuelMixRetryCount(0);
                        setPricingRetryCount(0);
                      }
                    }}
                    placeholder="Select BA"
                    className="font-medium focus:outline-none bg-transparent"
                    style={{ color: 'var(--text-primary)', height: '26px', fieldSizing: 'content', minWidth: '80px' }}
                  />
                )}
              </div>
            </div>
            {showBADropdown && (
              <div 
                className="absolute z-10 mt-1 rounded-lg shadow-lg max-h-60 overflow-y-auto"
                style={{ 
                  backgroundColor: 'var(--bg-secondary)',
                  borderWidth: '1px',
                  borderStyle: 'solid',
                  borderColor: 'var(--text-secondary)',
                  minWidth: '300px'
                }}
              >
                {allBAs
                  .filter(ba => 
                    !baSearchTerm || 
                    ba.code.toLowerCase().includes(baSearchTerm.toLowerCase()) ||
                    ba.name.toLowerCase().includes(baSearchTerm.toLowerCase())
                  )
                  .map(ba => (
                    <button
                      key={ba.code}
                      onClick={() => {
                        setLocation(ba.code);
                        setBaSearchTerm("");
                        setShowBADropdown(false);
                        // Set default zone if BA has pricing
                        if (ba.hasPricing && ba.representativeZone) {
                          setZone(ba.representativeZone);
                        }
                        setFuelMixRetryCount(0);
                        setPricingRetryCount(0);
                      }}
                      className="w-full text-left px-4 py-2 hover:bg-opacity-80 transition-colors"
                      style={{ 
                        backgroundColor: location === ba.code ? 'var(--active)' : 'transparent',
                        color: 'var(--text-primary)'
                      }}
                    >
                      <div className="font-semibold">{ba.code}</div>
                      <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {ba.name} {ba.hasPricing && '• Pricing Available'}
                      </div>
                    </button>
                  ))}
              </div>
            )}
            </div>
          </div>

          {/* Zone Field */}
          <div className="flex flex-col">
            <label className="text-xs font-semibold px-3" style={{ color: 'var(--text-secondary)', opacity: supportsPricing ? 1 : 0.5 }}>Zone</label>
            <div className="relative">
            <div className="flex items-center gap-0">
              <div 
                className="relative inline-flex items-center border rounded-lg px-3 transition-all" 
                style={{ 
                  borderColor: (zoneFocused || zoneHovered) && supportsPricing ? 'var(--active)' : 'transparent', 
                  height: '38px',
                  opacity: supportsPricing ? 1 : 0.5
                }}
                onMouseEnter={() => setZoneHovered(true)}
                onMouseLeave={() => setZoneHovered(false)}
              >
                {addressFocused ? (
                  <span className="pulse-dash font-medium select-none" style={{ color: 'var(--text-secondary)', height: '26px', minWidth: '100px' }}>--</span>
                ) : (
                  <input
                    ref={zoneInputRef}
                    type="text"
                    value={zoneSearchTerm || zone}
                    onChange={(e) => {
                      setZoneSearchTerm(e.target.value);
                      setShowZoneDropdown(true);
                    }}
                    onFocus={(e) => {
                      setZoneFocused(true);
                      if (supportsPricing) {
                        setShowZoneDropdown(true);
                      }
                      e.target.select();
                    }}
                    onBlur={() => {
                      setZoneFocused(false);
                      setTimeout(() => setShowZoneDropdown(false), 200);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.currentTarget.blur();
                        setFuelMixRetryCount(0);
                        setPricingRetryCount(0);
                      }
                    }}
                    placeholder={supportsPricing ? "Select Zone" : "N/A"}
                    disabled={!supportsPricing}
                    className="font-medium focus:outline-none bg-transparent disabled:cursor-not-allowed"
                    style={{ color: 'var(--text-primary)', height: '26px', fieldSizing: 'content', minWidth: '100px' }}
                  />
                )}
              </div>
            </div>
            {showZoneDropdown && supportsPricing && (
              <div 
                className="absolute z-10 mt-1 rounded-lg shadow-lg max-h-60 overflow-y-auto"
                style={{ 
                  backgroundColor: 'var(--bg-secondary)',
                  borderWidth: '1px',
                  borderStyle: 'solid',
                  borderColor: 'var(--text-secondary)',
                  minWidth: '250px'
                }}
              >
                {getZones(location)
                  .filter(z => 
                    !zoneSearchTerm || 
                    z.toLowerCase().includes(zoneSearchTerm.toLowerCase())
                  )
                  .map(z => (
                    <button
                      key={z}
                      onClick={() => {
                        setZone(z);
                        setZoneSearchTerm("");
                        setShowZoneDropdown(false);
                        setFuelMixRetryCount(0);
                        setPricingRetryCount(0);
                      }}
                      className="w-full text-left px-4 py-2 hover:bg-opacity-80 transition-colors"
                      style={{ 
                        backgroundColor: zone === z ? 'var(--active)' : 'transparent',
                        color: 'var(--text-primary)'
                      }}
                    >
                      <div className="font-semibold">{z}</div>
                    </button>
                  ))}
              </div>
            )}
            </div>
          </div>
        </div>

        {/* Data Display */}
        <div className="mt-8">
          {/* Geocoding status */}
          {geocodeMessage && (
            <Message
              type={geocodeMessage.startsWith("Found:") || geocodeMessage.startsWith("Auto-detected:") ? "info" : "error"}
              className="mb-4"
            >
              {geocodeMessage}
            </Message>
          )}

          {/* Info message for non-ISO BAs */}
          {!supportsPricing && location && (
            <Message type="info" className="mb-4">
              Pricing unavailable for {location}; showing fuel mix only.
            </Message>
          )}
          
          {/* Show message if no BA selected */}
          {!location && (
            <Message type="info" className="mb-4">
              Select a BA and zone to load data.
            </Message>
          )}
          
          {/* Loading state */}
          {!hasAnyData && (supportsPricing ? pricingLoading : fuelMixLoading) && (
            <Message type="loading" className="mb-4">
              Loading {supportsPricing ? "pricing" : "fuel mix"}
              {(supportsPricing ? pricingRetryCount : fuelMixRetryCount) > 0 && ` (Retry ${supportsPricing ? pricingRetryCount : fuelMixRetryCount}/3)`}
              {supportsPricing && fuelMixLoading && " and fuel mix"}
              ...
            </Message>
          )}
          
          {/* Show pricing error for ISOs, but only block chart if no fuel mix data available */}
          {supportsPricing && !pricingData && pricingError && !hasFuelMixData && (
            <Message type="error" className="mb-4">
              {(pricingError.message?.includes("quota exceeded") || pricingError.message?.includes("limit reached"))
                ? "Grid Status quota exceeded. Chart unavailable."
                : pricingError.message?.includes("Rate limit")
                  ? `Pricing rate limited${pricingRetryCount > 0 ? ` after ${pricingRetryCount} retries` : ""}. Chart unavailable.`
                  : `Pricing failed: ${pricingError.message || "Unknown error"}. Chart unavailable.`}
            </Message>
          )}
          
          {/* Show pricing error as simple text if fuel mix is available */}
          {supportsPricing && !pricingData && (pricingError || gridStatusQuotaExceeded) && hasFuelMixData && !useMockPricing && (
            <Message type="error" className="mb-4">
                {(pricingError?.message?.includes("quota exceeded") || pricingError?.message?.includes("limit reached") || gridStatusQuotaExceeded) 
                  ? (
                    <>
                      Pricing unavailable due to quota limits.{" "}
                      <button
                        onClick={handleEnableMockPricing}
                        className="underline font-semibold hover:opacity-80 transition-opacity"
                        style={{ color: 'var(--interactive-primary)' }}
                      >
                        Show mock pricing
                      </button>
                    </>
                  )
                  : pricingError?.message?.includes("Rate limit") 
                    ? "Pricing temporarily unavailable (rate limit)."
                    : "Pricing unavailable."}
            </Message>
          )}
          
          {/* Show message when displaying mock pricing data */}
          {supportsPricing && useMockPricing && hasFuelMixData && (
            <Message type="info" className="mb-4">
              Showing mock pricing.
            </Message>
          )}
          
          {/* Show fuel mix status as secondary/enhancement data for ISOs */}
          {supportsPricing && hasPricingDataLoaded && !hasFuelMixData && fuelMixLoading && (
            <Message type="loading" className="mb-4">
              Loading fuel mix{fuelMixRetryCount > 0 && ` (Retry ${fuelMixRetryCount}/3)`}...
            </Message>
          )}
          
          {supportsPricing && hasPricingDataLoaded && !hasFuelMixData && fuelMixError && (
            <Message type="error" className="mb-4">
              {(fuelMixError.message?.includes("rate limit") || fuelMixError.message?.includes("Rate limit"))
                ? "EIA rate limited. Showing pricing only."
                : `Fuel mix unavailable: ${fuelMixError.message || "Unknown error"}. Showing pricing only.`}
            </Message>
          )}
          
          {/* Show error for non-ISO BAs if fuel mix fails */}
          {!supportsPricing && location && !fuelMixData && fuelMixError && (
            <Message type="error" className="mb-4">
              {fuelMixError.message?.includes("rate limit") || fuelMixError.message?.includes("Rate limit") 
                ? "EIA rate limited. Try again soon."
                : `Fuel mix failed: ${fuelMixError.message || "Unknown error"}`}
            </Message>
          )}
          
          {/* Render chart when any data is available */}
          {hasAnyData && (
            <>
              <CombinedChart 
                fuelMixData={fuelMixData?.hourly || []} 
                pricingData={displayPricingData || []}
                location={location}
                baName={location}
                zoneName={zone}
              />
              {(fuelMixData?.meta || pricingData?.meta || useMockPricing) && (
                <div className="text-sm text-left space-y-1" style={{ color: 'var(--text-secondary)' }}>
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
                    </div>
                  )}
                  
                  {/* Grid Status API - Pricing */}
                  {pricingData?.meta && !useMockPricing && (
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
                    </div>
                  )}
                  
                  {/* Mock Pricing Data */}
                  {useMockPricing && (
                    <div className="flex flex-wrap items-center gap-x-2">
                      <span className="font-semibold" style={{ color: 'var(--interactive-primary)' }}>
                        Mock Pricing Data
                      </span>
                      <span>→</span>
                      <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                        {location} / Zone: {zone}
                      </span>
                      <span>→</span>
                      <span>Simulated LMP data for demonstration</span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </SWRConfig>
  );
}
