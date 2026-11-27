import type { Config } from "tailwindcss";
import colors from "tailwindcss/colors";
import plugin from "tailwindcss/plugin";

const accentPalettes = {
  blue: colors.blue,
  violet: colors.violet,
  teal: { ...colors.teal, 500: "#0e776e", 600: "#14645e" },
  orange: { ...colors.orange, 500: "#bc3e0c", 600: "#a6360d" },
};

function rgbChannels(hex: string) {
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16)).join(" ");
}

const config: Config = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // The app's blue utilities serve as its accent palette. Status colors use other palettes.
      colors: {
        blue: Object.fromEntries(
          Object.keys(accentPalettes.blue).map((shade) => [
            shade, `rgb(var(--accent-${shade}) / <alpha-value>)`,
          ]),
        ),
      },
      borderRadius: {
        xl: "1rem",
        "2xl": "1.25rem",
      },
      boxShadow: {
        soft: "0 16px 42px -10px rgb(var(--shadow-accent) / 0.20), 0 5px 12px -6px rgb(var(--shadow-neutral) / var(--shadow-neutral-opacity))",
        panel: "0 6px 18px -5px rgb(var(--shadow-accent) / 0.22), 0 2px 5px -2px rgb(var(--shadow-neutral) / var(--shadow-neutral-opacity))",
        float: "0 22px 52px -10px rgb(var(--shadow-accent) / 0.26), 0 9px 24px -6px rgb(var(--shadow-neutral) / var(--shadow-neutral-opacity))",
      },
    },
  },
  plugins: [
    plugin(({ addBase }) => {
      for (const [name, palette] of Object.entries(accentPalettes)) {
        const selector = name === "blue" ? ':root, [data-accent="blue"]' : `[data-accent="${name}"]`;
        addBase({
          [selector]: Object.fromEntries(
            Object.entries(palette).map(([shade, hex]) => [`--accent-${shade}`, rgbChannels(hex)]),
          ),
        });
      }
    }),
  ],
};

export default config;
