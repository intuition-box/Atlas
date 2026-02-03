import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { IBM_Plex_Mono } from "next/font/google";

import { Providers } from "@/components/providers";
import { Navigation } from "@/components/layout/navigation";

import "./globals.css";

const sans = localFont({
  src: "../fonts/Supreme-Variable.woff2",
  variable: "--font-sans",
  style: "normal",
  weight: "100 800",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  variable: '--font-mono',
  subsets: ["latin"],
  weight: "500"
});

export const metadata: Metadata = {
  title: "Orbyt",
  description: "",
  icons: [{
    rel: "icon",
    url: "/favicon.ico"
  }],
  openGraph: {
    title: "Orbyt",
    description: "",
    url: "",
    siteName: "Orbyt",
    images: [],
    type: "website",
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: "#000000",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${mono.variable} dark`}>
        <Providers>
          <Navigation />
          <main>
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
