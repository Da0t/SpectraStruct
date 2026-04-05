import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SpectraStruct",
  description: "Multimodal spectroscopy to molecular structure prediction",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-black text-white font-mono">
        <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 py-5 bg-black/80 backdrop-blur-md border-b border-white/5">
          <div className="text-sm font-bold tracking-[0.3em] uppercase">
            SpectraStruct
          </div>
          <div className="flex items-center gap-6">
            <span className="text-xs text-neutral-500 tracking-wide uppercase">
              DiamondHacks 2025
            </span>
          </div>
        </header>
        <main className="flex-1 pt-20">{children}</main>
      </body>
    </html>
  );
}
