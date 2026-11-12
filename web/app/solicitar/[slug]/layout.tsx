import type { Metadata } from "next";
import type { ReactNode } from "react";

// Só para dar nome à aba: a página é de cliente e não pode exportar `metadata`.
// Nome genérico; o específico a página põe com `useDocumentTitle` depois de carregar.
export const metadata: Metadata = { title: "Solicitar" };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
