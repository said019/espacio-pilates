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
        /* ── Tu Espacio Pilates VM — paleta de marca (hex = fuente de verdad) ── */
        tep: {
          blush:     "#C9ADA3",  /* primario — rosa empolvado */
          nude:      "#FBF6F4",  /* fondo principal — tinte suave */
          rose:      "#E8D3CE",  /* hover / tinte rosado */
          lavender:  "#C0AAD6",  /* acento lila — secundario */
          lilacSoft: "#E7DEF1",  /* tinte lila suave */
          gray:      "#E3E7E9",  /* neutro frío — bordes / muted */
          ink:       "#1A1A1A",  /* tinta — texto principal */
          gold:      "#B8915A",  /* acento dorado premium */
        },
        /* ── Alias backwards-compat `valiance-*` → mapeado a la paleta VM.
             Mantiene TODAS las claves heredadas (charcoal/mauve/plum/dusty/
             cream/wood) para no romper ~500 referencias en componentes. ── */
        valiance: {
          blush:    "#C9ADA3",  /* → tep.blush (primario) */
          nude:     "#FBF6F4",  /* → tep.nude (fondo) */
          rose:     "#E8D3CE",  /* → tep.rose (hover suave) */
          dusty:    "#C0AAD6",  /* → tep.lavender (acento medio) */
          mauve:    "#8B7785",  /* texto secundario — lila desaturado */
          plum:     "#5A4A57",  /* headers — lila profundo */
          charcoal: "#1A1A1A",  /* → tep.ink (texto principal) */
          cream:    "#FBF6F4",  /* → tep.nude (fondo cálido) */
          gold:     "#B8915A",  /* → tep.gold (acento premium) */
          wood:     "#A8794F",  /* acento cálido — dorado profundo */
        },
        /* ── Backwards-compat alias para no romper código heredado ── */
        punto: {
          cream:       "#FBF6F4",  /* → tep.nude */
          green:       "#C9ADA3",  /* → tep.blush */
          taupe:       "#8B7785",  /* lila desaturado (mauve) */
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
        /* tinted shadows — Tu Espacio Pilates VM (lavender / ink / gold) */
        "valiance-soft": "0 12px 40px -16px rgba(192,170,214,0.20)",
        "valiance-card": "0 20px 50px -25px rgba(201,173,163,0.24)",
        "valiance-deep": "0 30px 60px -25px rgba(26,26,26,0.45)",
        "valiance-gold": "0 15px 40px -20px rgba(184,145,90,0.45)",
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
