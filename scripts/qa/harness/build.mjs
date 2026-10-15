// Builds the QA harness (entry.tsx) for production: React in production mode, the app's own Tailwind CSS.
// Output: scripts/qa/harness/dist/{app.js,app.css,index.html}. Usage: node scripts/qa/harness/build.mjs
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const H = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(H, "../../..");
const SRC = path.join(ROOT, "src");
const OUT = path.join(H, "dist");
mkdirSync(OUT, { recursive: true });

const stub = { "@/app/app/HomeForms": "stubs/homeForms.tsx", "@/lib/supabase/client": "stubs/supabase.ts", "next/link": "stubs/link.tsx", "next/navigation": "stubs/navigation.ts", "next/dynamic": "stubs/dynamic.tsx" };
const profiling = process.argv.includes("--profile");

await build({
  entryPoints: [path.join(H, "entry.tsx")],
  bundle: true,
  outfile: path.join(OUT, "app.js"),
  jsx: "automatic",
  format: "esm",
  target: "safari16",
  minifyWhitespace: !process.argv.includes("--readable"),
  minifySyntax: !process.argv.includes("--readable"),
  sourcemap: false,
  logLevel: "warning",
  define: {
    "process.env.NODE_ENV": '"production"',
    "process.env.NEXT_PUBLIC_BUILD_ID": '"qa"',
    "process.env.NEXT_PUBLIC_SUPABASE_URL": '"https://example.supabase.co"',
    "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '"x"',
    "process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY": '""',
    "process.env.NEXT_PUBLIC_LIVEKIT_URL": '""',
  },
  // Plain CSS comes from Tailwind below; CSS modules (the shell's, the landing page's) are bundled as local CSS.
  loader: { ".css": "empty", ".module.css": "local-css" },
  plugins: [
    {
      name: "app-aliases",
      setup(b) {
        b.onResolve({ filter: /^(@\/|next\/(link|navigation|dynamic)$|react-dom\/client$)/ }, async (a) => {
          if (stub[a.path]) return { path: path.join(H, stub[a.path]) };
          if (a.path === "react-dom/client" && profiling) return b.resolve("react-dom/profiling", { resolveDir: ROOT, kind: a.kind });
          if (a.path.startsWith("@/")) return b.resolve("./" + a.path.slice(2), { resolveDir: SRC, kind: a.kind });
        });
      },
    },
  ],
});

// esbuild wrote the CSS modules next to app.js as app.css; keep them as modules.css (Tailwind writes app.css).
if (existsSync(path.join(OUT, "app.css"))) renameSync(path.join(OUT, "app.css"), path.join(OUT, "modules.css"));
else writeFileSync(path.join(OUT, "modules.css"), "");

// The app's CSS (src/app/globals.css) through its own Tailwind config.
const tw = path.join(OUT, "tw.config.cjs");
writeFileSync(
  tw,
  `const base = require(${JSON.stringify(path.join(ROOT, "tailwind.config.ts"))}).default;\nmodule.exports = { ...base, content: [${JSON.stringify(SRC.replace(/\\/g, "/") + "/**/*.{ts,tsx}")}, ${JSON.stringify(H.replace(/\\/g, "/") + "/*.tsx")}] };\n`,
);
writeFileSync(path.join(OUT, "postcss.config.cjs"), "module.exports = {};\n");
execFileSync(process.execPath, [path.join(ROOT, "node_modules/tailwindcss/lib/cli.js"), "-c", tw, "-i", path.join(SRC, "app/globals.css"), "-o", path.join(OUT, "app.css"), "--minify"], { stdio: "inherit", cwd: OUT });

writeFileSync(
  path.join(OUT, "index.html"),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"><title>Ctrl Room QA</title><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/modules.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`,
);
console.log(`built ${profiling ? "(profiling) " : ""}→ ${path.relative(ROOT, OUT)}`);
