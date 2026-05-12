/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        maroon: {
          50: "#fdf2f4",
          100: "#fae0e4",
          200: "#f3c2cb",
          300: "#e89aa9",
          400: "#d96b80",
          500: "#c44a60",
          600: "#a8324a",
          700: "#7b1d2e",
          800: "#5e1422",
          900: "#430d18",
          950: "#2b070f",
        },
        ink: {
          DEFAULT: "#15110f",
          soft: "#3b3531",
          muted: "#8a817b",
        },
        cream: {
          DEFAULT: "#f6f1ea",
          dark: "#ece4d8",
        },
        sand: {
          DEFAULT: "#e8ddc7",
          dark: "#dccdb0",
        },
        sage: {
          DEFAULT: "#6f9a80",
          dark: "#557a64",
        },
      },
      fontFamily: {
        display: ['"Fraunces"', "Georgia", "Cambria", "serif"],
        sans: ['"Inter"', "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
      letterSpacing: {
        tightest: "-0.045em",
      },
      maxWidth: {
        container: "1320px",
      },
      transitionTimingFunction: {
        smooth: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      keyframes: {
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        "marquee-rev": {
          "0%": { transform: "translateX(-50%)" },
          "100%": { transform: "translateX(0)" },
        },
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-14px)" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.9)", opacity: "0.7" },
          "100%": { transform: "scale(2.2)", opacity: "0" },
        },
        "grid-pan": {
          "0%": { backgroundPosition: "0 0" },
          "100%": { backgroundPosition: "44px 44px" },
        },
        "flow-x": {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
        "flow-y": {
          "0%": { backgroundPosition: "0 200%" },
          "100%": { backgroundPosition: "0 -200%" },
        },
      },
      animation: {
        marquee: "marquee 28s linear infinite",
        "marquee-rev": "marquee-rev 34s linear infinite",
        "fade-up": "fade-up 0.6s cubic-bezier(0.22,1,0.36,1) both",
        shimmer: "shimmer 1.5s linear infinite",
        float: "float 7s ease-in-out infinite",
        "spin-slow": "spin 22s linear infinite",
        "pulse-ring": "pulse-ring 2.4s cubic-bezier(0.22,1,0.36,1) infinite",
        "grid-pan": "grid-pan 3s linear infinite",
        "flow-x": "flow-x 2s linear infinite",
        "flow-y": "flow-y 2s linear infinite",
      },
    },
  },
  plugins: [],
};
