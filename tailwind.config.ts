import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        panel: "rgb(var(--panel) / <alpha-value>)",
        raised: "rgb(var(--raised) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        fg: "rgb(var(--fg) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        signal: "rgb(var(--signal) / <alpha-value>)",
        "signal-fg": "rgb(var(--signal-fg) / <alpha-value>)",
        alert: "rgb(var(--alert) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
  // Tailwind's --tw-* defaults go only on elements that use transforms, rings, shadows, filters and the like, not on
  // every element and its ::before/::after. On phones that made each restyle (opening the rooms, a room switch) about
  // a third slower.
  experimental: { optimizeUniversalDefaults: true },
} satisfies Config;
