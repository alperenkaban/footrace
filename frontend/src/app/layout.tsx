import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ClientInitializer from "@/components/ClientInitializer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FootQuiz | Canlı Futbol Bilgi Yarışması",
  description: "Gerçek zamanlı çevrimiçi futbol bilgi yarışması. Rakiplerinle yarış, futbol bilginle zirveye tırman!",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ClientInitializer>{children}</ClientInitializer>
      </body>
    </html>
  );
}
