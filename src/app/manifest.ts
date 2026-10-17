import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app",
    name: "Ctrl Room",
    short_name: "Ctrl Room",
    description: "Where the collective talks. An OpenCtrl original.",
    // ?launch=1: a phone reopens the last room (src/app/(spine)/app/LaunchRedirect.tsx).
    start_url: "/app?launch=1",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "any",
    background_color: "#060607",
    theme_color: "#060607",
    categories: ["social", "communication", "productivity"],
    icons: [
      { src: "/brand/ctrlroom-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/ctrlroom-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/ctrlroom-icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/brand/ctrlroom-icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "Communities",
        short_name: "Communities",
        description: "Open your communities",
        url: "/app",
        icons: [{ src: "/brand/ctrlroom-icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Direct messages",
        short_name: "Messages",
        description: "Open your direct messages",
        url: "/app/dm",
        icons: [{ src: "/brand/ctrlroom-icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
