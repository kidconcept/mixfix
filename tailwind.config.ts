import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
      fontSize: {
        'xs': 'var(--font-xs)',
        'sm': 'var(--font-sm)',
        'base': 'var(--font-base)',
        'lg': 'var(--font-lg)',
        'xl': 'var(--font-xl)',
        '2xl': 'var(--font-2xl)',
      },
      spacing: {
        'fluid': 'var(--spacing-fluid)',
        'fluid-sm': 'var(--spacing-fluid-sm)',
        'fluid-md': 'var(--spacing-fluid-md)',
        'fluid-lg': 'var(--spacing-fluid-lg)',
      },
    },
  },
  plugins: [],
};

export default config;
