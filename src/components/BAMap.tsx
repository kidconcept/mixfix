"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";
import L from "leaflet";
import { GeoJSON, MapContainer, TileLayer, Tooltip } from "react-leaflet";
import { fetchBAGeometryFeature, fetchAllBAGeometries, getBAGeometryMapping, sortBAFeaturesByArea } from "@/lib/config/ba-geometry";
import { getBAConfig } from "@/lib/config/balancing-authorities";
import { BAGeometryFeature } from "@/types/energy";

interface BAMapProps {
  baCode: string;
  onBAClick?: (baCode: string) => void;
  cachedGeometries?: Record<string, BAGeometryFeature>;
  onGeometriesLoaded?: (geometries: Record<string, BAGeometryFeature>) => void;
}

const DEFAULT_CENTER: [number, number] = [39.5, -98.35];
const DEFAULT_ZOOM = 4;

export default function BAMap({ baCode, onBAClick, cachedGeometries, onGeometriesLoaded }: BAMapProps) {
  const [feature, setFeature] = useState<BAGeometryFeature | null>(null);
  const [allFeatures, setAllFeatures] = useState<Record<string, BAGeometryFeature>>(cachedGeometries || {});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [map, setMap] = useState<LeafletMap | null>(null);
  const [hoveredBA, setHoveredBA] = useState<string | null>(null);
  
  // Track whether we've loaded all geometries to avoid re-fetching
  const hasLoadedAll = useRef(false);

  const mapping = useMemo(() => getBAGeometryMapping(baCode), [baCode]);
  const baConfig = useMemo(() => getBAConfig(baCode), [baCode]);

  // Sort features by area (largest to smallest) so smaller polygons render on top
  const sortedFeatures = useMemo(() => {
    const features = Object.entries(allFeatures).map(([code, feature]) => ({
      code,
      feature,
    }));
    
    // Sort by area descending (largest first) so they're rendered first
    // In Leaflet/SVG, later elements appear on top
    features.sort((a, b) => {
      const areaA = a.feature.area ?? Infinity;
      const areaB = b.feature.area ?? Infinity;
      return areaB - areaA; // Descending: largest first
    });
    
    return features;
  }, [allFeatures]);

  // Load all BA geometries with priority for the selected BA
  useEffect(() => {
    let isMounted = true;

    async function loadGeometries() {
      try {
        // First, load the selected BA immediately if it's not already loaded
        if (baCode && !allFeatures[baCode]) {
          const selectedGeometry = await fetchBAGeometryFeature(baCode);
          if (isMounted && selectedGeometry) {
            setAllFeatures(prev => ({ ...prev, [baCode]: selectedGeometry }));
          }
        }

        // Only load all geometries once
        if (!hasLoadedAll.current) {
          hasLoadedAll.current = true;
          // Only fetch if we don't have a good cache already
          const hasCache = Object.keys(allFeatures).length > 50;
          if (!hasCache) {
            const geometries = await fetchAllBAGeometries();
            if (isMounted) {
              setAllFeatures(geometries);
              // Notify parent of loaded geometries for caching
              if (onGeometriesLoaded) {
                onGeometriesLoaded(geometries);
              }
            }
          }
        }
      } catch (err) {
        console.error("Failed to load BA geometries:", err);
      }
    }

    loadGeometries();

    return () => {
      isMounted = false;
    };
  }, [baCode]);

  // Update selected BA geometry when baCode changes
  useEffect(() => {
    if (!baCode) {
      setFeature(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    if (!mapping || !mapping.isMappable) {
      setFeature(null);
      setError(mapping?.reason || "No geometry mapping available for this BA");
      setIsLoading(false);
      return;
    }

    // Use already-loaded geometry from allFeatures if available
    if (allFeatures[baCode]) {
      setFeature(allFeatures[baCode]);
      setError(null);
      setIsLoading(false);
    } else {
      // If not loaded yet, fetch it
      setIsLoading(true);
      setError(null);
      
      fetchBAGeometryFeature(baCode)
        .then((geometry) => {
          if (!geometry) {
            setFeature(null);
            setError("No geometry found for this BA");
            return;
          }
          setFeature(geometry);
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : "Failed to load BA geometry";
          setError(message);
          setFeature(null);
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [baCode, mapping, allFeatures]);

  useEffect(() => {
    if (!map || !baCode || !allFeatures[baCode]) return;

    const layer = L.geoJSON(allFeatures[baCode] as GeoJSON.Feature);
    const bounds = layer.getBounds();

    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.15));
    }
  }, [map, baCode, allFeatures]);

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        backgroundColor: "var(--bg-primary)",
        width: '100%',
        height: '100%'
      }}
    >
      <div
        className="px-4 py-3"
        style={{
          borderBottom: "1px solid var(--border-lighter)",
          color: "var(--text-secondary)",
        }}
      >
        <div className="text-base font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
          {baConfig?.name || baCode}
        </div>
        <div className="text-sm leading-relaxed">
          A Balancing Authority (BA) is a regional grid operator responsible for maintaining electricity supply and demand balance in real-time. 
          The energy mix shown represents generation sources across this entire control area.
        </div>
      </div>

      <div className="w-full relative" style={{ height: 'calc(100% - 88px)' }}>
        <MapContainer
          center={DEFAULT_CENTER}
          zoom={DEFAULT_ZOOM}
          style={{ height: "100%", width: "100%" }}
          scrollWheelZoom={true}
          ref={setMap}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {/* Render all BA boundaries in grey */}
          {sortedFeatures.map(({ code, feature: geoFeature }) => {
            // Skip the selected BA, we'll render it separately
            if (code === baCode) return null;
            
            const isHovered = hoveredBA === code;
            
            return (
              <GeoJSON
                key={code}
                data={geoFeature as GeoJSON.Feature}
                style={{
                  color: isHovered ? "#28cf7e" : "#ada6a6",
                  weight: isHovered ? 2 : 1,
                  fillColor: isHovered ? "#28cf7e" : "#ada6a6",
                  fillOpacity: isHovered ? 0.25 : 0.12,
                }}
                eventHandlers={{
                  mouseover: () => setHoveredBA(code),
                  mouseout: () => setHoveredBA(null),
                  click: () => {
                    if (onBAClick) {
                      onBAClick(code);
                    }
                  },
                }}
              >
                <Tooltip sticky direction="center" opacity={0.95}>
                  {geoFeature.properties.NAME}
                </Tooltip>
              </GeoJSON>
            );
          })}

          {/* Render selected BA with highlight */}
          {baCode && allFeatures[baCode] && (
            <GeoJSON
              key={`selected-${baCode}`}
              data={allFeatures[baCode] as GeoJSON.Feature}
              style={{
                color: "#2b8bd9",
                weight: 2,
                fillColor: "#2b8bd9",
                fillOpacity: 0.28,
              }}
              eventHandlers={{
                click: () => {
                  // Clicking currently selected BA does nothing (could close modal in future)
                },
              }}
            >
              <Tooltip sticky direction="center" opacity={0.95}>
                {allFeatures[baCode].properties.NAME}
              </Tooltip>
            </GeoJSON>
          )}
        </MapContainer>

        {isLoading && (
          <div
            className="absolute inset-0 flex items-center justify-center text-sm"
            style={{
              backgroundColor: "rgba(10, 15, 26, 0.16)",
              color: "var(--text-primary)",
            }}
          >
            Loading BA geometry...
          </div>
        )}

        {!isLoading && error && (
          <div
            className="absolute inset-0 flex items-center justify-center text-sm px-6 text-center"
            style={{
              backgroundColor: "rgba(10, 15, 26, 0.08)",
              color: "var(--text-secondary)",
            }}
          >
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
