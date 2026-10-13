import type { Metadata, Viewport } from "next";
import { DialogProvider } from "@/components/Dialogs";
import { siteUrl } from "@/lib/env";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: "Ctrl Room", template: "%s · Ctrl Room" },
  applicationName: "Ctrl Room",
  openGraph: { siteName: "Ctrl Room", type: "website" },
  twitter: { card: "summary_large_image" },
  description: "Rooms, threads, voice and video for communities. Full history, quiet notifications, no upsells. An OpenCtrl original.",
};

export const viewport: Viewport = {
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
      </body>
    </html>
  );
}
