import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { IBM_Plex_Mono } from "next/font/google";

import { Providers } from "@/components/providers";
import { NavigationController } from "@/components/navigation/navigation-controller";

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
  title: "Atlas",
  description: "",
  icons: [{
    rel: "icon",
    url: "/favicon.ico"
  }],
  openGraph: {
    title: "Atlas",
    description: "",
    url: "",
    siteName: "Atlas",
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
      <body className={`${sans.variable} ${mono.variable} grain dark`}>
        <Providers>
          <NavigationController />
          <main>
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
