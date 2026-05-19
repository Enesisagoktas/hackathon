import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CVMatch | CV Odaklı Geniş İş Arama",
  description:
    "CV yükleyerek becerilerini analiz et; lokasyon, uzaktan çalışma ve Türkiye iş platformları için arama linkleri oluştur."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
