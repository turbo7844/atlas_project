import "@fontsource/montserrat/400.css";
import "@fontsource/montserrat/500.css";
import "@fontsource/montserrat/600.css";
import "@fontsource/montserrat/700.css";
import "./globals.css";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Atlas — управленческий дашборд",
  description: "Маркетинг, выручка, движение денежных средств и продажи Atlas.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
