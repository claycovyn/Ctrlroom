import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ctrl Room",
    short_name: "Ctrl Room",
    description: "Where the collective talks. An OpenCtrl original.",
    start_url: "/app",
    display: "standalone",
    background_color: "#060607",
    theme_color: "#060607",
    icons: [
      { src: "/brand/ctrlroom-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/ctrlroom-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
