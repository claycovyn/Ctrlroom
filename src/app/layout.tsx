import type { Metadata, Viewport } from "next";
import { DialogProvider } from "@/components/Dialogs";
import { NativeFeel } from "@/components/NativeFeel";
import { ServiceWorker } from "@/components/ServiceWorker";
import { siteUrl } from "@/lib/env";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: "Ctrl Room", template: "%s · Ctrl Room" },
  applicationName: "Ctrl Room",
  openGraph: { siteName: "Ctrl Room", type: "website" },
  twitter: { card: "summary_large_image" },
  description: "Rooms, threads, voice and video for communities. Full history, quiet notifications, no upsells. An OpenCtrl original.",
  // Added to the Home Screen on iPhone/iPad: full screen, content under a translucent status bar (the layouts pad
  // themselves with env(safe-area-inset-*)). The touch icon is src/app/apple-icon.png.
  appleWebApp: { capable: true, title: "Ctrl Room", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false, email: false, address: false },
  // Next writes mobile-web-app-capable for appleWebApp.capable; older iOS only reads the apple- one.
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Pinch-zoom stays on (accessibility). Focus zoom on iPhone is stopped instead by 16px form text (globals.css).
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#060607" },
    { media: "(prefers-color-scheme: light)", color: "#f7f7f6" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <DialogProvider>{children}</DialogProvider>
        <ServiceWorker />
        <NativeFeel />
      </body>
    </html>
  );
}
