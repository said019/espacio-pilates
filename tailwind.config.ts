import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        /* Tu Espacio Pilates — paleta actual (hex = fuente de verdad) */
        tep: {
          pebble: "#444444",
          olive:  "#716D64",
          fern:   "#9B997B",
          dusk:   "#D1B9B4",
          ivory:  "#FAF8F6",
          oat:    "#DFD1C9",
          blush:     "#D1B9B4",
          nude:      "#FAF8F6",
          rose:      "#DFD1C9",
          lavender:  "#DFD1C9",
          lilacSoft: "#FAF8F6",
          gray:      "#DFD1C9",
          ink:       "#444444",
          gold:      "#9B997B",
        },
        /* Alias backwards-compat `valiance-*` para no romper componentes existentes. */
        valiance: {
          pebble:   "#444444",
          olive:    "#716D64",
          fern:     "#9B997B",
          dusk:     "#D1B9B4",
          ivory:    "#FAF8F6",
          oat:      "#DFD1C9",
          blush:    "#D1B9B4",
          nude:     "#FAF8F6",
          rose:     "#DFD1C9",
          lavender: "#DFD1C9",
          dusty:    "#D1B9B4",
          mauve:    "#716D64",
          plum:     "#444444",
          charcoal: "#444444",
          cream:    "#FAF8F6",
          gold:     "#9B997B",
          wood:     "#716D64",
        },
        /* ── Backwards-compat alias para no romper código heredado ── */
        punto: {
          cream: "#FAF8F6",
          green: "#9B997B",
          taupe: "#716D64",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        display:  ['"Cormorant Garamond"', '"Playfair Display"', 'serif'],
        body:     ['"Outfit"', 'system-ui', 'sans-serif'],
        gulfs:    ['"Cormorant Garamond"', '"Playfair Display"', 'serif'],
        alilato:  ['"Outfit"', 'system-ui', 'sans-serif'],
        bebas:    ['"Cormorant Garamond"', '"Playfair Display"', 'serif'],
        syne:     ['"Outfit"', 'system-ui', 'sans-serif'],
        dm:       ['"Outfit"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        "valiance-soft": "0 18px 45px -28px rgba(68,68,68,0.26)",
        "valiance-card": "0 24px 56px -34px rgba(113,109,100,0.28)",
        "valiance-deep": "0 30px 70px -30px rgba(68,68,68,0.42)",
        "valiance-gold": "0 18px 42px -26px rgba(155,153,123,0.46)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "pulse-dot": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.4", transform: "scale(0.7)" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(24px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "pulse-dot": "pulse-dot 2s ease-in-out infinite",
        "fade-up": "fade-up 0.8s cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
