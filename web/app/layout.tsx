import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Gestor de Tarefas — UniFECAF",
  description: "Gestor de demandas do time de marketing",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
