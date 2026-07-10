"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import Board from "@/components/Board";
import { listTeamsAll, type Team } from "@/lib/api";

// Quadro de SUBTIME (Fatia 7a). Le o teamId da URL e passa como subteamId
// pro Board (modo hibrido: compartilhadas da raiz + internas do subtime).
// O titulo mostra o NOME do time, nao o UUID. Guarda: se o id nao for um
// subtime valido, avisa em vez de renderizar um quadro sem sentido.
export default function QuadroSubtimePage() {
  const params = useParams();
  const teamId = typeof params.teamId === "string" ? params.teamId : "";

  const [team, setTeam] = useState<Team | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    listTeamsAll()
      .then((teams) => {
        if (!vivo) return;
        setTeam(teams.find((t) => t.id === teamId) ?? null);
        setCarregando(false);
      })
      .catch(() => {
        if (!vivo) return;
        setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [teamId]);

  return (
    <AppShell>
      {carregando ? (
        <div className="muted">Carregando…</div>
      ) : !team ? (
        <div className="muted">
          Time não encontrado. Verifique o endereço ou volte ao{" "}
          <a href="/quadro" className="text-accent underline">
            quadro geral
          </a>
          .
        </div>
      ) : team.parent_team_id === null ? (
        // e a raiz -> nao e subtime; o quadro geral e o lugar dela.
        <div className="muted">
          Este é o time principal. Use o{" "}
          <a href="/quadro" className="text-accent underline">
            quadro geral
          </a>
          .
        </div>
      ) : (
        <Board subteamId={team.id} title={`Quadro · ${team.name}`} />
      )}
    </AppShell>
  );
}
