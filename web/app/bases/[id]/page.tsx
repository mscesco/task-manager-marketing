"use client";
import { useParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import PaginaDaBase from "@/components/bases/PaginaDaBase";

// Uma Base aberta: /bases/<id> (Spec 056, fatia E). Quem decide se a pessoa a
// vê é o servidor (`base.read` no time dela); sem acesso é 404, igual a "não
// existe" -- de propósito, para não confirmar que ela existe.
export default function BasePage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  return (
    <AppShell>
      <PaginaDaBase id={id} />
    </AppShell>
  );
}
