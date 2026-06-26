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
        /* ── Valiance Pilates brand palette ── */
        valiance: {
          blush:    "#FAE5E7",  /* Pantone 705 C — del logo */
          nude:     "#FDF7F8",  /* fondo principal */
          rose:     "#F0D0D5",  /* hover suave */
          dusty:    "#D9B5BA",  /* acento medio */
          mauve:    "#8C6B6F",  /* texto secundario */
          plum:     "#6B4F53",  /* headers tipo COSTOS */
          charcoal: "#1A1A1A",  /* texto principal */
          cream:    "#FBF7F4",  /* fondo cálido */
          gold:     "#C9A96E",  /* acento premium (mármol) */
          wood:     "#A87749",  /* acento cálido */
        },
        /* ── Backwards-compat alias para no romper código heredado ── */
        punto: {
          cream:       "#FDF7F8",
          green:       "#FAE5E7",
          taupe:       "#8C6B6F",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        /* ── Valiance Pilates — tipografías oficiales ── */
        display:  ['"Cormorant Garamond"', '"Playfair Display"', 'serif'],
        body:     ['"Inter"', 'system-ui', 'sans-serif'],
        /* ── Aliases backwards-compat ── */
        gulfs:    ['"Cormorant Garamond"', '"Playfair Display"', 'serif'],
        alilato:  ['"Inter"', 'system-ui', 'sans-serif'],
        bebas:    ['"Cormorant Garamond"', '"Playfair Display"', 'serif'],
        syne:     ['"Inter"', 'system-ui', 'sans-serif'],
        dm:       ['"Inter"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        /* tinted shadows — Valiance */
        "valiance-soft": "0 12px 40px -16px rgba(140,107,111,0.18)",
        "valiance-card": "0 20px 50px -25px rgba(140,107,111,0.22)",
        "valiance-deep": "0 30px 60px -25px rgba(26,26,26,0.45)",
        "valiance-gold": "0 15px 40px -20px rgba(201,169,110,0.45)",
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
