"use client";
// `/notificacoes`: chega-se pelo "Ver todas" do sino. A tela mora em
// `components/TelaDeNotificacoes.tsx`.

import AppShell from "@/components/AppShell";
import TelaDeNotificacoes from "@/components/TelaDeNotificacoes";

export default function NotificacoesPage() {
  return (
    <AppShell>
      <TelaDeNotificacoes />
    </AppShell>
  );
}
