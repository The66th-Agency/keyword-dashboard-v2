import type { Metadata } from "next";
import { Inter, Space_Grotesk, Instrument_Serif } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: "italic",
});

export const metadata: Metadata = {
  title: "Keyword Dashboard - The 66th",
  description: "Deep keyword research pipeline",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable} ${instrumentSerif.variable} dark h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground" style={{ letterSpacing: "-0.02em" }}>
        <header className="border-b border-border px-8 py-3 shrink-0">
          <a href="/clients" className="text-sm font-semibold tracking-widest hover:opacity-80 transition-opacity">
            <span className="text-[#B1E5E3]">66</span>
            <span className="text-muted-foreground ml-1.5">THE 66TH</span>
            <span className="text-muted-foreground/50 mx-2">/</span>
            <span className="text-muted-foreground/70">KEYWORD DASHBOARD</span>
          </a>
        </header>
        <main className="flex-1 max-w-6xl w-full mx-auto px-8 py-10">{children}</main>
      </body>
    </html>
  );
}
