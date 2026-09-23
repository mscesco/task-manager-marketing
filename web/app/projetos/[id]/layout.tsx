import type { Metadata } from "next";
import type { ReactNode } from "react";

// ⚠️ ESTE ARQUIVO EXISTE SÓ PELO NOME DA ABA. A página é `"use client"`, e
// página de cliente não pode exportar `metadata` -- o layout, que é servidor,
// pode. Sem ele a aba herdaria o título padrão, igual ao de todas as outras
// (revisão de títulos, 21/09; ver `lib/documentTitle.ts`).
//
// ⚠️ NOME GENÉRICO DE PROPÓSITO: o específico (o nome da tarefa, do projeto…)
// só existe depois de carregar, e quem o põe é o `useDocumentTitle` da página.
export const metadata: Metadata = { title: "Projeto" };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
