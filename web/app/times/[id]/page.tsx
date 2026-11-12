"use client";
// Rota da tela de um time; a tela mora em `components/TeamScreen.tsx` (app/ fica fora do vitest).

import { useParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import TeamScreen from "@/components/TeamScreen";

export default function TimePage() {
  const params = useParams<{ id: string }>();
  return (
    <AppShell>
      <TeamScreen teamId={params.id} />
    </AppShell>
  );
}
