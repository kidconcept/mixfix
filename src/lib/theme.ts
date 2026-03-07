/**
 * Central color theme configuration for MixFix
 * Supports light/dark mode theming
 */

export interface ColorTheme {
  // Backgrounds
  background: {
    primary: string;    // Main page background
    secondary: string;  // Cards, inputs, surfaces
  };
  
  // Text
  text: {
    primary: string;    // Main content text
    secondary: string;  // Muted, less important text
  };
  
  // Interactive
  active: string;       // Active/hover states, links, accents
  
  // Status
  alert: string;        // Alerts, warnings, status messages
  
  // Chart: Fuel Mix (12 colors: 8 renewables + 4 consumables)
  fuelMix: {
    // Renewables (8)
    solar: string;        // Light turquoise
    wind: string;         // Mid-tone water blue
    hydro: string;        // Deeper water blue
    geothermal: string;   // Earth tones - volcanic orange
    biomass: string;      // Forest green - organic
    batteries: string;    // Electric purple - storage
    imports: string;      // Lavender - grid interchange
    other: string;        // Light gray - catch-all
    // Consumables (4)
    coal: string;         // Dark charcoal
    gas: string;          // Warm amber
    oil: string;          // Deep rust
    nuclear: string;      // Deep blue
  };
  
  // Chart: Pricing (Green Theme)
  pricing: {
    lmp: string;        // Dark green
    energy: string;     // Medium green
    congestion: string; // Light green
    loss: string;       // Lightest green
  };
}

// Light theme (current design)
export const lightTheme: ColorTheme = {
  background: {
    primary: '#faf9f3',    // Light cream page background
    secondary: '#e2dedd',  // Light pink-gray for cards/inputs
  },
  text: {
    primary: '#161516',    // Nearly black text
    secondary: '#3e3e3e',  // Dark gray text
  },
  active: '#bce3e7',       // Light cyan for interactive elements
  alert: '#fb4635',        // Coral red for alerts
  fuelMix: {
    // Renewables (8)
    solar: '#e5efee',       // Very light mint
    wind: '#d4e9e6',        // Light seafoam
    hydro: '#a3d0cf',       // Soft mint
    geothermal: '#71c0bf',  // Turquoise
    biomass: '#88b2b4',     // Dusty teal
    batteries: '#589797',   // Sea green
    imports: '#204d46',     // Deep teal
    other: '#082926',       // Very dark teal
    // Consumables (4)
    coal: '#cec8c9',        // Light gray-mauve
    gas: '#ada6a6',         // Medium gray
    oil: '#796869',         // Dusty mauve
    nuclear: '#474040',     // Dark gray-brown
  },
  pricing: {
    lmp: '#d44a0e',         // Deep orange
    energy: '#e8743f',      // Bright orange
    congestion: '#e89c79',  // Peachy orange
    loss: '#f3e1c0',        // Warm beige
  },
};

// Dark theme (will be customized separately)
export const darkTheme: ColorTheme = {
  background: {
    primary: '#0a0f1a',    // Dark navy background
    secondary: '#1a1f2e',  // Slightly lighter for surfaces
  },
  text: {
    primary: '#e5e7eb',    // Light gray for main text
    secondary: '#9ca3af',  // Medium gray for secondary text
  },
  active: '#f3e0c0',       // Same as light theme
  alert: '#e89c79',        // Same as light theme
  fuelMix: {
    // Keep fuel mix colors same for consistency in dark mode
    solar: '#a1d0cf',
    wind: '#70c0bf',
    hydro: '#87b1b3',
    geothermal: '#589796',
    biomass: '#214c48',
    batteries: '#082926',
    imports: '#ccc8c8',
    other: '#ada6a6',
    coal: '#796869',
    gas: '#47403f',
    oil: '#5a4e4d',
    nuclear: '#2d2d2d',
  },
  pricing: {
    // Keep pricing colors same for consistency in dark mode
    lmp: '#e87340',
    energy: '#d44a0e',
    congestion: '#e5f0ee',
    loss: '#d5e9e6',
  },
};

// Current active theme (default to light)
export const theme = lightTheme;

// Export legacy SOURCE_COLORS for backward compatibility
export const SOURCE_COLORS = {
  // Renewables (8)
  solar: theme.fuelMix.solar,
  wind: theme.fuelMix.wind,
  hydro: theme.fuelMix.hydro,
  geothermal: theme.fuelMix.geothermal,
  biomass: theme.fuelMix.biomass,
  batteries: theme.fuelMix.batteries,
  imports: theme.fuelMix.imports,
  other: theme.fuelMix.other,
  // Consumables (4)
  coal: theme.fuelMix.coal,
  gas: theme.fuelMix.gas,
  oil: theme.fuelMix.oil,
  nuclear: theme.fuelMix.nuclear,
};

export const PRICING_COLORS = {
  lmp: theme.pricing.lmp,
  energy: theme.pricing.energy,
  congestion: theme.pricing.congestion,
  loss: theme.pricing.loss,
};
