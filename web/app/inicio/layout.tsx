import type { Metadata } from "next";
import type { ReactNode } from "react";

// ⚠️ ESTE ARQUIVO EXISTE SÓ PELO NOME DA ABA. A página é `"use client"`, e
// página de cliente não pode exportar `metadata` -- o layout, que é servidor,
// pode. Sem ele a aba herdaria o título padrão (ver `lib/documentTitle.ts`).
export const metadata: Metadata = { title: "Início" };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
