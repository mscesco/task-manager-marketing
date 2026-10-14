"use client";
// app/inicio/page.tsx
// A tela inicial do time (Spec 058): a entrada do sistema (§10.1).
//
// ⚠️ O TIME É O DA BARRA (D2), e a tela ESPERA ele resolver: `active === null`
// é "ainda não sei", e pedir antes traria os números da organização inteira
// por um instante -- o mesmo cuidado de "Minhas tarefas".
//
// ⚠️ SEM AO VIVO: recarrega ao abrir e ao voltar para a aba
// (`visibilitychange`). É um retrato do time, não um quadro em tempo real.

import { useCallback, useEffect, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import TeamDashboard from "@/components/TeamDashboard";
import Loading from "@/components/Loading";
import { ApiError, getDashboard, type DashboardResponse } from "@/lib/api";
import { navHref } from "@/lib/activeTeam";
import { useActiveTeam, useActiveTeamId } from "@/lib/useActiveTeam";

export default function HomePage() {
  return (
    <AppShell>
      <Home />
    </AppShell>
  );
}

function Home() {
  const { active, teamName } = useActiveTeam();
  const teamId = useActiveTeamId();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ⚠️ GUARDA DE CORRIDA: trocar de time na barra com um pedido em voo não
  // pode deixar os números do time anterior na tela do novo.
  const latest = useRef(0);
  const load = useCallback(() => {
    const n = ++latest.current;
    getDashboard(teamId)
      .then((d) => {
        if (n !== latest.current) return;
        setData(d);
        setError(null);
      })
      .catch((e: ApiError) => {
        if (n === latest.current) setError(e.message || "Não consegui carregar o painel.");
      });
  }, [teamId]);

  useEffect(() => {
    if (active === null) return;
    setData(null);
    load();
    // ⚠️ `active === null` e não `active`: o objeto é novo a cada render da
    // barra (o defeito de 14/09 em "Minhas tarefas").
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, active === null]);

  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden && active !== null) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load, active]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={teamName ? `Início · ${teamName}` : "Início"} />
      {error ? (
        <div className="error-box" role="alert">
          {error}
        </div>
      ) : data === null ? (
        <Loading />
      ) : (
        <TeamDashboard
          data={data}
          links={{
            mine: navHref("/minhas-tarefas", active),
            queue: navHref("/solicitacoes", active),
          }}
        />
      )}
    </div>
  );
}
