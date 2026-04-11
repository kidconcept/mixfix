// Types for energy generation data

export type Granularity = 'daily' | 'monthly' | 'yearly';

export type EnergySource =
  // Renewables (8)
  | "solar"
  | "wind"
  | "hydro"
  | "geothermal"
  | "biomass"
  | "batteries"
  | "imports"
  | "other"
  // Consumables (4)
  | "coal"
  | "gas"
  | "oil"
  | "nuclear";

export interface HistoricalRecord {
  date: string; // ISO 8601 format
  [key: string]: number | string; // Allows for dynamic source keys
}

export interface LMPDataPoint {
  time: string; // ISO 8601 format
  lmp: number; // $/MWh
  energy: number; // $/MWh
  congestion: number; // $/MWh
  loss: number; // $/MWh
  spp?: number; // $/MWh — ERCOT Settlement Point Price
}

export interface BAGeometryMapping {
  baCode: string;
  controlAreaName: string | null;
  isMappable: boolean;
  reason?: string;
}

export interface BAGeometryFeatureProperties {
  NAME: string;
  ID?: string;
  [key: string]: string | number | null | undefined;
}

export interface BAGeometryPolygonGeometry {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
}

export interface BAGeometryFeature {
  type: "Feature";
  geometry: BAGeometryPolygonGeometry;
  properties: BAGeometryFeatureProperties;
  area?: number; // Pre-calculated area in square meters (for overlap prioritization)
}

export interface BAGeometryFeatureCollection {
  type: "FeatureCollection";
  features: BAGeometryFeature[];
}

