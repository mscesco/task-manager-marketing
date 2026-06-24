"use client";
import AppShell from "@/components/AppShell";
import Board from "@/components/Board";

// Quadro GERAL: panorama de tudo (sem projectId). A logica do board mora em
// components/Board.tsx, compartilhada com a pagina de projeto (Entrega 11).
export default function QuadroPage() {
  return (
    <AppShell>
      <Board title="Quadro geral" />
    </AppShell>
  );
}
