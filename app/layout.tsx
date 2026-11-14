import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// The fonts ship inside the folder, so it looks the same on Windows and Mac.
const display = localFont({ src: "./fonts/PlayfairDisplay.ttf", variable: "--font-display", weight: "400 900", display: "swap" });
const body = localFont({ src: "./fonts/InterTight.ttf", variable: "--font-body", weight: "100 900", display: "swap" });
const mono = localFont({ src: "./fonts/RobotoMono.ttf", variable: "--font-mono", weight: "100 700", display: "swap" });

export const metadata: Metadata = {
  title: "Twin",
  description: "You on camera without filming. Pick a look, give it your voice, and HeyGen makes the video.",
  applicationName: "Twin",
};

export const viewport: Viewport = {
  themeColor: "#0D0A08",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${display.variable} ${body.variable} ${mono.variable}`} suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
