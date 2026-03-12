import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { IBM_Plex_Mono } from "next/font/google";

import { Providers } from "@/components/providers";
import { NavigationController } from "@/components/navigation/navigation-controller";

import "./globals.css";
import { meta } from "@/config/constants";

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
  metadataBase: new URL(meta.url),
  title: {
    default: `${meta.name} | ${meta.title}`,
    template: `%s | ${meta.name}`,
  },
  description: meta.description,
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: meta.title,
    description: meta.description,
    url: meta.url,
    siteName: meta.name,
    images: [
      {
        url: meta.og.image,
        width: meta.og.width,
        height: meta.og.height,
      },
    ],
    locale: meta.og.locale,
    type: meta.og.type,
  },
  robots: {
    index: true,
    follow: true,
    noarchive: true,
    nosnippet: false,
    noimageindex: true,
    nocache: true,
  },
  icons: {
    icon: {
      rel: 'icon',
      url: meta.icons.favicon,
      type: 'image/x-icon',
      sizes: '48x48',
    },
    shortcut: {
      rel: 'icon',
      url: meta.icons.app,
      type: 'image/svg+xml',
    },
    apple: meta.icons.touchIcon,
    other: {
      rel: 'image_src',
      url: meta.og.image,
    },
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: meta.themeColor,
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
