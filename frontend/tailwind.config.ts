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
        soft: "0 18px 50px rgba(15, 23, 42, 0.12)",
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
