/**
 * Theme system for MixFix - curated color themes
 */

export interface Theme {
  id: string;
  name: string;
  mode: 'light' | 'dark';
  colors: Record<string, string>;
}

export const themes: Theme[] = [
  // Light theme 1: OG (Original Caribbean Sunset)
  {
    id: 'og',
    name: 'OG',
    mode: 'light',
    colors: {
      '--bg-primary': '#faf9f3',
      '--bg-secondary': '#e2dedd',
      '--bg-card': '#ffffff',
      '--text-primary': '#161516',
      '--text-secondary': '#3e3e3e',
      '--text-tertiary': '#6b7280',
      '--border-subtle': 'rgba(0, 0, 0, 0.1)',
      '--interactive-primary': '#2b8bd9',
      '--interactive-hover': '#bce3e7',
      '--active': '#bce3e7',
      // Pricing: Warm oranges/reds
      '--price-lmp': '#d44a0e',
      '--price-energy': '#e8743f',
      '--price-congestion': '#e89c79',
      '--price-loss': '#f3e1c0',
      // Renewables: Caribbean blues/teals
      '--fuel-solar': '#e5efee',
      '--fuel-wind': '#d4e9e6',
      '--fuel-hydro': '#a3d0cf',
      '--fuel-geothermal': '#71c0bf',
      '--fuel-biomass': '#88b2b4',
      '--fuel-batteries': '#589797',
      '--fuel-imports': '#204d46',
      '--fuel-other': '#082926',
      '--fuel-charging': '#ea9424',
      // Consumables: Muted greys
      '--fuel-coal': '#cec8c9',
      '--fuel-gas': '#ada6a6',
      '--fuel-oil': '#796869',
      '--fuel-nuclear': '#474040',
    }
  },
  // Dark theme 1: Forest Shadow
  {
    id: 'forest-shadow',
    name: 'Forest Shadow',
    mode: 'dark',
    colors: {
      '--bg-primary': '#0f1410',
      '--bg-secondary': '#1a221c',
      '--bg-card': '#253028',
      '--text-primary': '#e7f0e9',
      '--text-secondary': '#9fb5a4',
      '--text-tertiary': '#6d8572',
      '--border-subtle': '#3b4f40',
      '--interactive-primary': '#86efac',
      '--interactive-hover': '#4ade80',
      '--active': '#238b45',
      // Pricing: Warm yellows/amber
      '--price-lmp': '#fed976',
      '--price-energy': '#fecc5c',
      '--price-congestion': '#fdb462',
      '--price-loss': '#fee6b3',
      // Renewables: Yellow-green to blue-green gradient
      '--fuel-solar': '#ffffb2',
      '--fuel-wind': '#d9f0a3',
      '--fuel-hydro': '#a1d99b',
      '--fuel-geothermal': '#74c476',
      '--fuel-biomass': '#41ab5d',
      '--fuel-batteries': '#238b45',
      '--fuel-imports': '#006837',
      '--fuel-other': '#004d29',
      '--fuel-charging': '#ea7ef6',
      // Consumables: Warm forest browns
      '--fuel-coal': '#a68862',
      '--fuel-gas': '#8b7355',
      '--fuel-oil': '#6b5442',
      '--fuel-nuclear': '#4a3d2f',
    }
  },
];

// Default theme (OG - Original Caribbean Sunset)
export const defaultTheme: Theme = themes[0];

/**
 * Apply a theme by setting CSS custom properties on :root
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  
  Object.entries(theme.colors).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });
  
  // Store theme preference
  if (typeof window !== 'undefined') {
    localStorage.setItem('mixfix-theme', theme.id);
  }
}

/**
 * Get the current theme from localStorage or return default
 */
export function getCurrentTheme(): Theme {
  if (typeof window === 'undefined') {
    return defaultTheme;
  }
  
  const stored = localStorage.getItem('mixfix-theme');
  if (!stored) {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) {
      return themes.find((t) => t.mode === 'dark') || defaultTheme;
    }
    return themes.find((t) => t.mode === 'light') || defaultTheme;
  }
  
  return themes.find(t => t.id === stored) || defaultTheme;
}
