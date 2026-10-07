import type { Metadata } from "next";
import type { ReactNode } from "react";

// Só pelo nome da aba (ver `app/tarefa/[id]/layout.tsx`): a página é de
// cliente e não pode exportar `metadata`.
export const metadata: Metadata = { title: "Bases" };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
