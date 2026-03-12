"use client";

import { useEffect, useMemo, useState } from "react";
import type { Map as LeafletMap } from "leaflet";
import L from "leaflet";
import { GeoJSON, MapContainer, TileLayer, Tooltip } from "react-leaflet";
import { fetchBAGeometryFeature, getBAGeometryMapping } from "@/lib/config/ba-geometry";
import { BAGeometryFeature } from "@/types/energy";

interface BAMapProps {
  baCode: string;
}

const DEFAULT_CENTER: [number, number] = [39.5, -98.35];
const DEFAULT_ZOOM = 4;

export default function BAMap({ baCode }: BAMapProps) {
  const [feature, setFeature] = useState<BAGeometryFeature | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [map, setMap] = useState<LeafletMap | null>(null);

  const mapping = useMemo(() => getBAGeometryMapping(baCode), [baCode]);

  useEffect(() => {
    let isMounted = true;

    async function loadGeometry() {
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

      setIsLoading(true);
      setError(null);

      try {
        const geometry = await fetchBAGeometryFeature(baCode);
        if (!isMounted) return;

        if (!geometry) {
          setFeature(null);
          setError("No geometry found for this BA");
          return;
        }

        setFeature(geometry);
      } catch (err) {
        if (!isMounted) return;
        const message = err instanceof Error ? err.message : "Failed to load BA geometry";
        setError(message);
        setFeature(null);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadGeometry();

    return () => {
      isMounted = false;
    };
  }, [baCode, mapping]);

  useEffect(() => {
    if (!map || !feature) return;

    const layer = L.geoJSON(feature as GeoJSON.Feature);
    const bounds = layer.getBounds();

    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.15));
    }
  }, [map, feature]);

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{
        borderColor: "var(--border-subtle)",
        backgroundColor: "var(--bg-primary)",
      }}
    >
      <div
        className="px-3 py-2 text-sm"
        style={{
          borderBottom: "1px solid var(--border-lighter)",
          color: "var(--text-secondary)",
        }}
      >
        Control-area map for <span style={{ color: "var(--text-primary)" }}>{baCode || "-"}</span>
      </div>

      <div className="h-[340px] w-full relative">
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

          {feature && (
            <GeoJSON
              data={feature as GeoJSON.Feature}
              style={{
                color: "#2b8bd9",
                weight: 2,
                fillColor: "#2b8bd9",
                fillOpacity: 0.28,
              }}
            >
              <Tooltip sticky direction="center" opacity={0.95}>
                {feature.properties.NAME}
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
