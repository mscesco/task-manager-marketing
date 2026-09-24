"use client";
// lib/useDocumentTitle.ts
// Põe na aba o nome que só se sabe depois de carregar (ver `documentTitle.ts`).

import { useEffect } from "react";

import { pageTitle } from "@/lib/documentTitle";

/**
 * Põe o nome da tela na aba assim que ele existe.
 *
 * `null` (ainda carregando) NÃO mexe no título: o nome genérico do
 * `layout.tsx` da rota continua valendo até o dado chegar.
 */
export function useDocumentTitle(name: string | null | undefined): void {
  useEffect(() => {
    const limpo = name?.trim();
    if (!limpo) return;
    document.title = pageTitle(limpo);
  }, [name]);
}
