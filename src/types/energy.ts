// Types for energy generation data

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

export interface GenerationDataPoint {
  source: EnergySource;
  value: number; // GW
  percentage: number;
  color: string;
}

export interface RegionSnapshot {
  region: string;
  timestamp: string;
  totalGW: number;
  mix: GenerationDataPoint[];
}

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
}

