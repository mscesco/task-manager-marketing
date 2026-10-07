import type { Metadata } from "next";
import type { ReactNode } from "react";

// Só pelo nome da aba; o nome da base, quem põe é o `useDocumentTitle` da
// página, depois de carregar (ver `app/tarefa/[id]/layout.tsx`).
export const metadata: Metadata = { title: "Base" };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
