import type { Metadata } from "next";
import type { ReactNode } from "react";

// Só para dar nome à aba: a página é de cliente e não pode exportar `metadata`.
export const metadata: Metadata = { title: "Meu perfil" };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
