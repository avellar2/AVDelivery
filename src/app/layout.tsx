import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "AV Delivery — Plataforma para restaurantes",
    template: "%s | AV Delivery",
  },
  description:
    "Plataforma de delivery por assinatura para hamburguerias, pizzarias, lanchonetes e restaurantes.",
};

export const viewport: Viewport = {
  themeColor: "#ea580c",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-zinc-50 text-zinc-900">{children}</body>
    </html>
  );
}
