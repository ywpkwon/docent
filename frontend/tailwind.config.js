/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        highlight: {
          yellow: "#fef08a",
          purple: "#e9d5ff",
          red: "#fecaca",
        },
      },
      animation: {
        "pulse-slow": "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        waveform: "waveform 1.2s ease-in-out infinite",
      },
      keyframes: {
        waveform: {
          "0%, 100%": { transform: "scaleY(0.4)" },
          "50%": { transform: "scaleY(1.0)" },
        },
      },
    },
  },
  plugins: [],
};
