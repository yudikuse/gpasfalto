// FILE: app/layout.tsx
import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "GP Asfalto – Dashboard de Manutenção 2025",
  description:
    "Dashboard de custos de manutenção da GP Asfalto baseado nas ordens de compra de 2025.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
