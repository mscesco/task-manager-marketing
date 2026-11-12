"use client";
import { useParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import PaginaDaBase from "@/components/bases/PaginaDaBase";

// Uma Base aberta. Sem acesso o servidor responde 404, igual a "não existe",
// para não confirmar que ela existe.
export default function BasePage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  return (
    <AppShell>
      <PaginaDaBase id={id} />
    </AppShell>
  );
}
