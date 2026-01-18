import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Google_Sans_Code, Google_Sans_Flex } from "next/font/google";
import "./globals.css";
import UserMenu from "@/components/layout/user-menu";
import Logo from "@/components/brand/logo";

const sans = Google_Sans_Flex({
  variable: '--font-sans',
  subsets: ["latin"],
});

const mono = Google_Sans_Code({
  variable: '--font-mono',
  subsets: ["latin"],
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
      <body
        className={`${sans.variable} ${mono.variable} dark h-full min-h-dvh antialiased selection:bg-foreground/30`}
      >
        <header className="group fixed z-50 flex flex-col p-6 text-sm text-white/60">
          <Logo />
          <UserMenu />
        </header>
        <main className="mx-auto max-w-5xl flex-col px-4 flex flex-1 items-center justify-center">
          {children}
        </main>
      </body>
    </html>
  );
}
