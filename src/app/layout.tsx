import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ModernWeb Studio | GTA Web Design Agency",
  description:
    "Modern, responsive websites for GTA-based small businesses. Fast turnaround, affordable pricing, professional quality. Toronto web design agency.",
  keywords: [
    "web design",
    "Toronto",
    "GTA",
    "web development",
    "small business",
    "responsive websites",
    "ModernWeb Studio",
  ],
  openGraph: {
    title: "ModernWeb Studio | GTA Web Design Agency",
    description:
      "Modern, responsive websites for GTA-based small businesses. Fast turnaround, affordable pricing.",
    type: "website",
    locale: "en_CA",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Navbar />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}