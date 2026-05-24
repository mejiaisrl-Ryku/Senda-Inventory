/** @type {import('tailwindcss').Config} */
const defaultTheme = require("tailwindcss/defaultTheme");

module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      // Inter as the primary sans-serif font
      fontFamily: {
        sans: ["Inter", ...defaultTheme.fontFamily.sans],
      },

      fontSize: {
        // 11px label text used in stat cards and table headers
        "2xs": ["11px", { lineHeight: "1.4", letterSpacing: "0.07em" }],
      },

      borderRadius: {
        // 8px card radius used across redesigned cards
        card: "8px",
      },

      colors: {
        // Primary accent — Kyru official brand palette
        brand: {
          50:  "#f0fdf7",
          100: "#d0f7e8",
          400: "#4dcf9b",
          500: "#3EBF8A",   // primary accent (buttons, active states, highlights)
          600: "#2da070",   // hover / darker shade
          700: "#1f8059",
          900: "#0d3d2a",
          // Kyru gradient palette (charts, data visualisations)
          "grad-from": "#5DD1E6",  // gradient start (cyan)
          "grad-to":   "#57C49B",  // gradient end (teal-green)
        },

        // Custom gray scale — dark values map to the brand palette exactly:
        //   gray-950 → #1a1a1a  (page background)
        //   gray-800 → #2a2a2a  (card background)
        //   gray-400 → #8a8a8a  (muted text)
        gray: {
          50:  "#f9f9f9",
          100: "#f0f0f0",
          200: "#e0e0e0",
          300: "#c0c0c0",
          400: "#8a8a8a",
          500: "#666666",
          600: "#484848",
          700: "#363636",
          800: "#2a2a2a",
          900: "#222222",
          950: "#1a1a1a",
        },
      },
    },
  },
  plugins: [],
};
