"use client";

import CombinedChart from "@/components/CombinedChart";
import Message from "@/components/Message";
import ThemeSwitcher from "../components/ThemeSwitcher";
import { useState, useEffect, useRef } from "react";
import useSWR, { SWRConfig } from "swr";
import { swrConfig } from "@/lib/swrConfig";
import { getAllBAs, getZones, getZonesWithNames, hasPricingData, getRepresentativeZone } from "@/lib/config/balancing-authorities";
import { LMPDataPoint } from "@/types/energy";

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
  const baDropdownRef = useRef<HTMLDivElement>(null);
  const selectedBARef = useRef<HTMLButtonElement>(null);
  const zoneDropdownRef = useRef<HTMLDivElement>(null);
  const selectedZoneRef = useRef<HTMLButtonElement>(null);

  // Scroll selected BA into center view when dropdown opens
  useEffect(() => {
    if (showBADropdown && selectedBARef.current && baDropdownRef.current) {
      setTimeout(() => {
        selectedBARef.current?.scrollIntoView({ block: 'center', behavior: 'auto' });
      }, 0);
    }
  }, [showBADropdown]);

  // Scroll selected zone into center view when dropdown opens
  useEffect(() => {
    if (showZoneDropdown && selectedZoneRef.current && zoneDropdownRef.current) {
      setTimeout(() => {
        selectedZoneRef.current?.scrollIntoView({ block: 'center', behavior: 'auto' });
      }, 0);
    }
  }, [showZoneDropdown]);

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
        const zoneDisplay = data.suggestedNode || data.zone;
        setGeocodeMessage(
          `${address} → ${data.iso}${zoneDisplay ? ` / ${zoneDisplay}` : ""}`
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
                  const zoneDisplay = geocodeData.suggestedNode || geocodeData.zone;
                  setGeocodeMessage(
                    `${autoAddress} → ${geocodeData.iso}${zoneDisplay ? ` / ${zoneDisplay}` : ""}`
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
    <>
    <SWRConfig value={swrConfig}>
      <main className="min-h-screen p-6 md:p-10">
        {/* All Fields - Inline Edit Style */}
        <div className="flex flex-wrap gap-6 items-baseline">
          {/* Brand */}
          <div className="flex flex-col">
            <div className="text-xs px-2 invisible">_</div>
            <div className="font-bold text-2xl" style={{ color: 'var(--text-primary)' }}>mixfix</div>
          </div>
          
          {/* Form Fields Group - wraps together */}
          <div className="flex flex-wrap gap-2 items-baseline">
          
          {/* Date Field */}
          <div className="flex flex-col">
            <label className="text-xs font-semibold px-2" style={{ color: 'var(--text-secondary)' }}>Date</label>
            <div className="flex items-center gap-0">
            <div 
              className="relative inline-flex items-center border rounded-lg px-2 transition-all" 
              style={{ borderColor: (dateFocused || dateHovered) ? 'var(--active)' : 'transparent', height: '32px' }}
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
                style={{ color: 'var(--text-primary)', height: '22px', fieldSizing: 'content' }}
              />
            </div>
            </div>
          </div>

          {/* Address Field */}
          <div className="flex flex-col">
            <label className="text-xs font-semibold px-2" style={{ color: 'var(--text-secondary)' }}>Location</label>
            <div className="relative">
            <div className="flex items-center gap-0">
              <div 
                className="relative inline-flex items-center border rounded-lg px-2 transition-all" 
                style={{ borderColor: (addressFocused || addressHovered) ? 'var(--active)' : 'transparent', height: '32px' }}
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
                  style={{ color: 'var(--text-primary)', height: '22px', fieldSizing: 'content' }}
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
            <label className="text-xs font-semibold px-2" style={{ color: 'var(--text-secondary)' }}>BA</label>
            <div className="relative">
            <div className="flex items-center gap-0">
              <div 
                className="relative inline-flex items-center border rounded-lg px-2 transition-all" 
                style={{ borderColor: (baFocused || baHovered) ? 'var(--active)' : 'transparent', height: '32px' }}
                onMouseEnter={() => setBaHovered(true)}
                onMouseLeave={() => setBaHovered(false)}
              >
                {addressFocused ? (
                  <span className="pulse-dash font-medium select-none" style={{ color: 'var(--text-secondary)', height: '22px', minWidth: '80px' }}>--</span>
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
                    style={{ color: 'var(--text-primary)', height: '22px', fieldSizing: 'content', minWidth: '80px' }}
                  />
                )}
              </div>
            </div>
            {showBADropdown && (
              <div 
                ref={baDropdownRef}
                className="absolute z-10 mt-1 rounded-lg shadow-lg overflow-y-auto"
                style={{ 
                  backgroundColor: 'var(--background)',
                  borderWidth: '1px',
                  borderStyle: 'solid',
                  borderColor: 'var(--active)',
                  minWidth: '300px',
                  maxHeight: '240px'
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
                      ref={location === ba.code ? selectedBARef : null}
                      onClick={() => {
                        setLocation(ba.code);
                        setAddress(""); // Clear location field when BA changes
                        setBaSearchTerm("");
                        setShowBADropdown(false);
                        // Set default zone if BA has pricing
                        if (ba.hasPricing && ba.representativeZone) {
                          setZone(ba.representativeZone);
                        }
                        setFuelMixRetryCount(0);
                        setPricingRetryCount(0);
                      }}
                      className="w-full text-left px-4 py-1.5 hover:bg-opacity-80 transition-colors"
                      style={{ 
                        backgroundColor: location === ba.code ? 'var(--active)' : 'transparent',
                        color: 'var(--text-primary)'
                      }}
                    >
                      <div className="text-base">{ba.name}</div>
                      <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {ba.code} {ba.hasPricing && '• Pricing Available'}
                      </div>
                    </button>
                  ))}
              </div>
            )}
            </div>
          </div>

          {/* Zone Field */}
          <div className="flex flex-col">
            <label className="text-xs font-semibold px-2" style={{ color: 'var(--text-secondary)', opacity: supportsPricing ? 1 : 0.5 }}>Zone</label>
            <div className="relative">
            <div className="flex items-center gap-0">
              <div 
                className="relative inline-flex items-center border rounded-lg px-2 transition-all" 
                style={{ 
                  borderColor: (zoneFocused || zoneHovered) && supportsPricing ? 'var(--active)' : 'transparent', 
                  height: '32px',
                  opacity: supportsPricing ? 1 : 0.5
                }}
                onMouseEnter={() => setZoneHovered(true)}
                onMouseLeave={() => setZoneHovered(false)}
              >
                {addressFocused ? (
                  <span className="pulse-dash font-medium select-none" style={{ color: 'var(--text-secondary)', height: '22px', minWidth: '100px' }}>--</span>
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
                    style={{ color: 'var(--text-primary)', height: '22px', fieldSizing: 'content', minWidth: '100px' }}
                  />
                )}
              </div>
            </div>
            {showZoneDropdown && supportsPricing && (
              <div 
                ref={zoneDropdownRef}
                className="absolute z-10 mt-1 rounded-lg shadow-lg overflow-y-auto"
                style={{ 
                  backgroundColor: 'var(--background)',
                  borderWidth: '1px',
                  borderStyle: 'solid',
                  borderColor: 'var(--active)',
                  minWidth: '300px',
                  maxHeight: '240px'
                }}
              >
                {getZonesWithNames(location)
                  .filter(z => 
                    !zoneSearchTerm || 
                    z.code.toLowerCase().includes(zoneSearchTerm.toLowerCase()) ||
                    z.name.toLowerCase().includes(zoneSearchTerm.toLowerCase())
                  )
                  .map(z => (
                    <button
                      key={z.code}
                      ref={zone === z.code ? selectedZoneRef : null}
                      onClick={() => {
                        setZone(z.code);
                        setZoneSearchTerm("");
                        setShowZoneDropdown(false);
                        setFuelMixRetryCount(0);
                        setPricingRetryCount(0);
                      }}
                      className="w-full text-left px-4 py-1.5 hover:bg-opacity-80 transition-colors"
                      style={{ 
                        backgroundColor: zone === z.code ? 'var(--active)' : 'transparent',
                        color: 'var(--text-primary)'
                      }}
                    >
                      <div className="text-base">{z.name}</div>
                      <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {z.code}
                      </div>
                    </button>
                  ))}
              </div>
            )}
            </div>
          </div>
          
          </div>{/* End Form Fields Group */}
        </div>

        {/* Data Display */}
        <div className="mt-4">
          {/* Consolidated status messages */}
          {(() => {
            const messages: React.ReactNode[] = [];
            let hasError = false;
            
            // Geocoding status
            if (geocodeMessage) {
              // Success messages contain " → ", errors don't
              const isError = !geocodeMessage.includes(" → ");
              if (isError) hasError = true;
              messages.push(geocodeMessage);
            }
            
            // Non-ISO BA info
            if (!supportsPricing && location) {
              messages.push(`Pricing unavailable for ${location}; showing fuel mix only`);
            }
            
            // No BA selected
            if (!location) {
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
            if (supportsPricing && !pricingData && (pricingError || gridStatusQuotaExceeded) && hasFuelMixData && !useMockPricing) {
              hasError = true;
              if (pricingError?.message?.includes("quota exceeded") || pricingError?.message?.includes("limit reached") || gridStatusQuotaExceeded) {
                messages.push(
                  <>
                    Pricing unavailable due to quota limits.{" "}
                    <button
                      onClick={handleEnableMockPricing}
                      className="underline transition-colors"
                      style={{ color: 'var(--text-primary)' }}
                      onMouseEnter={(e) => e.currentTarget.style.color = 'var(--interactive-primary)'}
                      onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
                    >
                      Show mock pricing
                    </button>
                  </>
                );
              } else {
                messages.push(
                  pricingError?.message?.includes("Rate limit")
                    ? "Pricing temporarily unavailable (rate limit)"
                    : "Pricing unavailable"
                );
              }
            }
            
            // Mock pricing active
            if (supportsPricing && useMockPricing && hasFuelMixData) {
              messages.push("Showing mock pricing");
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
            if (!supportsPricing && location && !fuelMixData && fuelMixError) {
              hasError = true;
              messages.push(
                fuelMixError.message?.includes("rate limit") || fuelMixError.message?.includes("Rate limit")
                  ? "EIA rate limited. Try again soon."
                  : `Fuel mix failed: ${fuelMixError.message || "Unknown error"}`
              );
            }
            
            if (messages.length === 0) return null;
            
            return (
              <Message type={hasError ? "error" : "info"} className="mb-4">
                {messages.map((msg, i) => (
                  <span key={i}>
                    {i > 0 && " | "}
                    {msg}
                  </span>
                ))}
              </Message>
            );
          })()}
          
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

                  <div className="pt-1">
                    <ThemeSwitcher />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </SWRConfig>
    </>
  );
}
