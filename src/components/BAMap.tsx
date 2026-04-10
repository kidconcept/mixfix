"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";
import L from "leaflet";
import { GeoJSON, MapContainer, TileLayer, Tooltip } from "react-leaflet";
import { fetchBAGeometryFeature, fetchAllBAGeometries, getBAGeometryMapping } from "@/lib/config/ba-geometry";
import { getBAConfig, getAllBAs, getZonesWithNames, hasPricingData, getRepresentativeZone } from "@/lib/config/balancing-authorities";
import { BAGeometryFeature } from "@/types/energy";

interface BAMapProps {
  isOpen: boolean;
  onClose: () => void;
  balancingAuthority: string;
  zone: string;
  onBalancingAuthorityChange: (code: string) => void;
  onZoneChange: (code: string) => void;
}

const DEFAULT_CENTER: [number, number] = [39.5, -98.35];
const DEFAULT_ZOOM = 4;

export default function BAMap({ isOpen, onClose, balancingAuthority, zone, onBalancingAuthorityChange, onZoneChange }: BAMapProps) {
  const allBAs = getAllBAs();

  // Map state
  const [allFeatures, setAllFeatures] = useState<Record<string, BAGeometryFeature>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [map, setMap] = useState<LeafletMap | null>(null);
  const [hoveredBA, setHoveredBA] = useState<string | null>(null);

  // Dropdown state
  const [showBADropdown, setShowBADropdown] = useState(false);
  const [baSearchTerm, setBaSearchTerm] = useState("");
  const [baFocused, setBaFocused] = useState(false);
  const [baHovered, setBaHovered] = useState(false);
  const [showZoneDropdown, setShowZoneDropdown] = useState(false);
  const [zoneSearchTerm, setZoneSearchTerm] = useState("");
  const [zoneFocused, setZoneFocused] = useState(false);
  const [zoneHovered, setZoneHovered] = useState(false);

  const hasLoadedAll = useRef(false);
  const baInputRef = useRef<HTMLInputElement>(null);
  const zoneInputRef = useRef<HTMLInputElement>(null);
  const baDropdownRef = useRef<HTMLDivElement>(null);
  const selectedBARef = useRef<HTMLButtonElement>(null);
  const zoneDropdownRef = useRef<HTMLDivElement>(null);
  const selectedZoneRef = useRef<HTMLButtonElement>(null);

  const mapping = useMemo(() => getBAGeometryMapping(balancingAuthority), [balancingAuthority]);
  const baConfig = useMemo(() => getBAConfig(balancingAuthority), [balancingAuthority]);
  const supportsPricing = hasPricingData(balancingAuthority);

  // Sort features by area (largest to smallest) so smaller polygons render on top
  const sortedFeatures = useMemo(() => {
    const features = Object.entries(allFeatures).map(([code, feature]) => ({ code, feature }));
    features.sort((a, b) => (b.feature.area ?? Infinity) - (a.feature.area ?? Infinity));
    return features;
  }, [allFeatures]);

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

  // Preload all BA geometries in the background on mount
  useEffect(() => {
    let isMounted = true;

    async function preload() {
      if (!hasLoadedAll.current) {
        hasLoadedAll.current = true;
        const hasCache = Object.keys(allFeatures).length > 50;
        if (!hasCache) {
          try {
            await fetchAllBAGeometries((partial) => {
              if (isMounted) setAllFeatures(prev => ({ ...prev, ...partial }));
            });
          } catch (err) {
            console.error("Failed to preload BA geometries:", err);
          }
        }
      }
    }

    if (document.readyState === 'complete') {
      preload();
    } else {
      const handleLoad = () => preload();
      window.addEventListener('load', handleLoad);
      return () => {
        isMounted = false;
        hasLoadedAll.current = false;
        window.removeEventListener('load', handleLoad);
      };
    }

    return () => {
      isMounted = false;
      hasLoadedAll.current = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load geometry for the currently selected BA
  useEffect(() => {
    if (!balancingAuthority) {
      setError(null);
      setIsLoading(false);
      return;
    }

    if (!mapping || !mapping.isMappable) {
      setError(mapping?.reason || "No geometry mapping available for this BA");
      setIsLoading(false);
      return;
    }

    if (allFeatures[balancingAuthority]) {
      setError(null);
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setError(null);

    fetchBAGeometryFeature(balancingAuthority)
      .then((geometry) => {
        if (!isMounted) return;
        if (!geometry) {
          setError("No geometry found for this BA");
          return;
        }
        setAllFeatures(prev => ({ ...prev, [balancingAuthority]: geometry }));
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : "Failed to load BA geometry");
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => { isMounted = false; };
  }, [balancingAuthority, mapping]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-zoom to selected BA whenever it or its geometry changes
  useEffect(() => {
    if (!map || !balancingAuthority || !allFeatures[balancingAuthority]) return;
    const layer = L.geoJSON(allFeatures[balancingAuthority] as GeoJSON.Feature);
    const bounds = layer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.15));
  }, [map, balancingAuthority, allFeatures]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)' }}
      onClick={onClose}
    >
      <div
        className="relative rounded-lg shadow-2xl"
        style={{ backgroundColor: 'var(--bg-primary)', width: '80vw', maxHeight: '90vh', overflow: 'visible' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-2 right-3 z-10 text-2xl leading-none hover:opacity-70 transition-opacity"
          style={{ color: 'var(--text-primary)' }}
          aria-label="Close modal"
        >
          ×
        </button>

        {/* Modal Content */}
        <div style={{ height: '90vh', display: 'flex', flexDirection: 'column', borderRadius: 'inherit' }}>

          {/* Grid and Zone selectors */}
          <div
            className="flex flex-wrap items-end gap-4 px-4 py-3 shrink-0"
            style={{ borderBottom: '1px solid var(--border-subtle)', position: 'relative', zIndex: 1000 }}
          >
            {/* BA Field */}
            <div className="flex flex-col form-field-block">
              <label className="font-semibold pr-2" style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-form-xs)' }}>Balancing Authority</label>
              <div className="relative">
                <div className="flex items-center gap-0">
                  <div
                    className="relative inline-flex items-center border rounded-lg pr-2 transition-all form-field-shell"
                    style={{ borderColor: (baFocused || baHovered) ? 'var(--active)' : 'var(--border-subtle)', height: 'var(--form-height)', paddingLeft: '3px' }}
                    onMouseEnter={() => setBaHovered(true)}
                    onMouseLeave={() => setBaHovered(false)}
                  >
                    <input
                      ref={baInputRef}
                      type="text"
                      value={baSearchTerm || baConfig?.name || balancingAuthority}
                      style={{ color: 'var(--text-primary)', height: 'var(--input-height)', fontSize: 'var(--font-form-base)', minWidth: '10ch', fieldSizing: 'content' } as React.CSSProperties}
                      onChange={(e) => { setBaSearchTerm(e.target.value); setShowBADropdown(true); }}
                      onFocus={(e) => { setBaFocused(true); setShowBADropdown(true); e.target.select(); }}
                      onBlur={() => { setBaFocused(false); setTimeout(() => setShowBADropdown(false), 200); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                      placeholder="Select BA"
                      className="font-medium focus:outline-none bg-transparent"
                    />
                    <span className="ml-1 select-none" style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-form-base)' }}>▾</span>
                  </div>
                </div>
                {showBADropdown && (
                  <div
                    ref={baDropdownRef}
                    className="absolute z-[1000] mt-1 rounded-lg shadow-lg overflow-y-auto"
                    style={{ backgroundColor: 'var(--bg-primary)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--active)', minWidth: 'var(--dropdown-min-width)', maxHeight: '240px' }}
                  >
                    {allBAs
                      .filter(ba => !baSearchTerm || ba.code.toLowerCase().includes(baSearchTerm.toLowerCase()) || ba.name.toLowerCase().includes(baSearchTerm.toLowerCase()))
                      .map(ba => (
                        <button
                          key={ba.code}
                          ref={balancingAuthority === ba.code ? selectedBARef : null}
                          onClick={() => {
                            onBalancingAuthorityChange(ba.code);
                            setBaSearchTerm('');
                            setShowBADropdown(false);
                            if (ba.hasPricing && ba.representativeZone) onZoneChange(ba.representativeZone);
                          }}
                          onMouseEnter={(e) => { if (balancingAuthority !== ba.code) e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'; }}
                          onMouseLeave={(e) => { if (balancingAuthority !== ba.code) e.currentTarget.style.backgroundColor = 'transparent'; }}
                          className="w-full text-left px-4 py-1.5 transition-colors"
                          style={{ backgroundColor: balancingAuthority === ba.code ? 'var(--active)' : 'transparent', color: 'var(--text-primary)' }}
                        >
                          <div className="text-base">{ba.name}</div>
                          <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>{ba.code} {ba.hasPricing && '• Pricing Available'}</div>
                        </button>
                      ))}
                  </div>
                )}
              </div>
            </div>

            {/* Zone Field */}
            {supportsPricing && (
            <div className="flex flex-col form-field-block">
              <label className="font-semibold pr-2" style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-form-xs)' }}>Zone</label>
              <div className="relative">
                <div className="flex items-center gap-0">
                  <div
                    className="relative inline-flex items-center border rounded-lg pr-2 transition-all form-field-shell"
                    style={{ borderColor: (zoneFocused || zoneHovered) && supportsPricing ? 'var(--active)' : 'var(--border-subtle)', height: 'var(--form-height)', paddingLeft: '3px', opacity: supportsPricing ? 1 : 0.5 }}
                    onMouseEnter={() => setZoneHovered(true)}
                    onMouseLeave={() => setZoneHovered(false)}
                  >
                    <input
                      ref={zoneInputRef}
                      type="text"
                      value={zoneSearchTerm || (zone ? (getZonesWithNames(balancingAuthority).find(z => z.code === zone)?.name || zone) : '')}
                      style={{ color: 'var(--text-primary)', height: 'var(--input-height)', fontSize: 'var(--font-form-base)', minWidth: '10ch', fieldSizing: 'content' } as React.CSSProperties}
                      onChange={(e) => { setZoneSearchTerm(e.target.value); setShowZoneDropdown(true); }}
                      onFocus={(e) => { setZoneFocused(true); if (supportsPricing) setShowZoneDropdown(true); e.target.select(); }}
                      onBlur={() => { setZoneFocused(false); setTimeout(() => setShowZoneDropdown(false), 200); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                      placeholder={supportsPricing ? 'Select Zone' : 'N/A'}
                      disabled={!supportsPricing}
                      className="font-medium focus:outline-none bg-transparent disabled:cursor-not-allowed"
                    />
                    <span className="ml-1 select-none" style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-form-base)' }}>▾</span>
                  </div>
                </div>
                {showZoneDropdown && supportsPricing && (
                  <div
                    ref={zoneDropdownRef}
                    className="absolute z-[1000] mt-1 rounded-lg shadow-lg overflow-y-auto"
                    style={{ backgroundColor: 'var(--bg-primary)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--active)', minWidth: 'var(--dropdown-min-width)', maxHeight: '240px' }}
                  >
                    {getZonesWithNames(balancingAuthority)
                      .filter(z => !zoneSearchTerm || z.code.toLowerCase().includes(zoneSearchTerm.toLowerCase()) || z.name.toLowerCase().includes(zoneSearchTerm.toLowerCase()))
                      .map(z => (
                        <button
                          key={z.code}
                          ref={zone === z.code ? selectedZoneRef : null}
                          onClick={() => { onZoneChange(z.code); setZoneSearchTerm(''); setShowZoneDropdown(false); }}
                          onMouseEnter={(e) => { if (zone !== z.code) e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'; }}
                          onMouseLeave={(e) => { if (zone !== z.code) e.currentTarget.style.backgroundColor = 'transparent'; }}
                          className="w-full text-left px-4 py-1.5 transition-colors"
                          style={{ backgroundColor: zone === z.code ? 'var(--active)' : 'transparent', color: 'var(--text-primary)' }}
                        >
                          <div className="text-base">{z.name}</div>
                          <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>{z.code}</div>
                        </button>
                      ))}
                  </div>
                )}
              </div>
            </div>
            )}

            {/* Inline description */}
            {balancingAuthority && (
              <div className="shrink-0 pb-1" style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-form-base)' }}>
                Fuel mix across {baConfig?.name || balancingAuthority} BA{supportsPricing && zone ? `, Pricing across ${getZonesWithNames(balancingAuthority).find(z => z.code === zone)?.name || zone} Zone` : ''}.
              </div>
            )}
          </div>

          {/* Info + Map */}
          <div className="flex-1 overflow-hidden" style={{ minHeight: 0 }}>
            <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--bg-primary)', width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
              <div className="w-full relative" style={{ flex: 1, minHeight: 0 }}>
                <MapContainer
                  center={DEFAULT_CENTER}
                  zoom={DEFAULT_ZOOM}
                  style={{ height: '100%', width: '100%' }}
                  scrollWheelZoom={true}
                  ref={setMap}
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />

                  {/* All non-selected BA boundaries */}
                  {sortedFeatures.map(({ code, feature: geoFeature }) => {
                    if (code === balancingAuthority) return null;
                    const isHovered = hoveredBA === code;
                    return (
                      <GeoJSON
                        key={code}
                        data={geoFeature as GeoJSON.Feature}
                        style={{
                          color: isHovered ? '#28cf7e' : '#ada6a6',
                          weight: isHovered ? 2 : 1,
                          fillColor: isHovered ? '#28cf7e' : '#ada6a6',
                          fillOpacity: isHovered ? 0.25 : 0.12,
                        }}
                        eventHandlers={{
                          mouseover: () => setHoveredBA(code),
                          mouseout: () => setHoveredBA(null),
                          click: () => {
                            const repZone = getRepresentativeZone(code);
                            onBalancingAuthorityChange(code);
                            if (repZone) onZoneChange(repZone);
                          },
                        }}
                      >
                        <Tooltip sticky direction="center" opacity={0.95}>
                          {geoFeature.properties.NAME}
                        </Tooltip>
                      </GeoJSON>
                    );
                  })}

                  {/* Selected BA highlighted */}
                  {balancingAuthority && allFeatures[balancingAuthority] && (
                    <GeoJSON
                      key={`selected-${balancingAuthority}`}
                      data={allFeatures[balancingAuthority] as GeoJSON.Feature}
                      style={{ color: '#2b8bd9', weight: 2, fillColor: '#2b8bd9', fillOpacity: 0.28 }}
                    >
                      <Tooltip sticky direction="center" opacity={0.95}>
                        {allFeatures[balancingAuthority].properties.NAME}
                      </Tooltip>
                    </GeoJSON>
                  )}
                </MapContainer>

                {isLoading && (
                  <div
                    className="absolute inset-0 flex items-center justify-center text-sm"
                    style={{ backgroundColor: 'rgba(10, 15, 26, 0.16)', color: 'var(--text-primary)' }}
                  >
                    Loading BA geometry...
                  </div>
                )}

                {!isLoading && error && (
                  <div
                    className="absolute inset-0 flex items-center justify-center text-sm px-6 text-center"
                    style={{ backgroundColor: 'rgba(10, 15, 26, 0.08)', color: 'var(--text-secondary)' }}
                  >
                    {error}
                  </div>
                )}
              </div>
              <div
                className="px-4 py-2 shrink-0"
                style={{ borderTop: '1px solid var(--border-lighter)', color: 'var(--text-secondary)' }}
              >
                <div className="text-xs leading-relaxed">
                  The U.S. electric grid is divided into Balancing Authorities (BAs) — regional operators responsible for matching electricity generation to demand in real time. Each BA controls a geographic area shown on this map. Note that these boundaries represent operational control areas and may not align exactly with the reporting regions in the EIA dataset, which can aggregate data differently. Pricing zones are sub-regions within a BA where locational marginal prices (LMP) reflect the real-time cost of delivering power — these zones are not shown on the map as their boundaries are defined by electrical topology rather than geography. Boundaries from the DHS Control Areas dataset (ArcGIS). Fuel mix from the EIA Hourly Grid Monitor and Grid Status API. Pricing from ISO real-time LMP feeds via Grid Status.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
