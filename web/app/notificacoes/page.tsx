"use client";
// `/notificacoes` -- Spec 053, fatia F. Chega-se pelo "Ver todas" do sino (D26):
// o menu lateral nao ganha item. A tela inteira mora em
// `components/TelaDeNotificacoes.tsx`, que tem guardiao.

import AppShell from "@/components/AppShell";
import TelaDeNotificacoes from "@/components/TelaDeNotificacoes";

export default function NotificacoesPage() {
  return (
    <AppShell>
      <TelaDeNotificacoes />
    </AppShell>
  );
}
