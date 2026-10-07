"use client";
import AppShell from "@/components/AppShell";
import ListaDeBases from "@/components/bases/ListaDeBases";

// A lista de Bases (Spec 056, fatia E). O conteúdo mora em `components/` para o
// vitest alcançar -- `app/` fica fora do `include`.
export default function BasesPage() {
  return (
    <AppShell>
      <ListaDeBases />
    </AppShell>
  );
}
