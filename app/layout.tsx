import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CVMatch | CV Analizi ve Gerçek İş İlanı Eşleştirme",
  description:
    "PDF/DOCX CV'nizi yükleyin; AI profilinizi çıkarsın, veritabanındaki aktif gerçek iş ilanları arasından en uygunlarını skorlayıp doğrudan ilan detay linkleriyle göstersin."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
