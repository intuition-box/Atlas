import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Noto_Sans, Noto_Serif, Noto_Sans_Mono } from "next/font/google";
import "./globals.css";
import { Separator } from "@/components/ui/separator";
import UserMenu from "@/components/layout/user-menu";
import Logo from "@/components/logo";

const serif = Noto_Serif({
  variable: "--font-serif",
  subsets: ["latin"],
});

const sans = Noto_Sans({
  variable: '--font-sans'
});

const mono = Noto_Sans_Mono({
  variable: '--font-sans'
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
        className={`${serif.variable} ${sans.variable} ${mono.variable} dark h-full min-h-dvh antialiased selection:bg-foreground/30`}
      >
        <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4">
          <header className="flex gap-4 items-center py-6 text-sm text-white/60">
            <div className="group flex gap-4 items-center">
              <Logo />
              <div className="flex gap-2 opacity-0 blur-sm -translate-y-1 will-change-[opacity,filter,transform] transition-all duration-300 ease-in-out group-hover:opacity-100 group-hover:blur-none group-hover:translate-y-0 hover:opacity-100 hover:blur-none hover:translate-y-0">
                <Separator orientation="vertical" />
                <Link href="/about" className="hover:text-white/90">About</Link>
              </div>
            </div>

            <UserMenu />
          </header>
          <main className="flex flex-1 items-center justify-center">{children}</main>
        </div>
      </body>
    </html>
  );
}
