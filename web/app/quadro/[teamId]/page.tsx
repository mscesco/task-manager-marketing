"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import Board from "@/components/Board";
import { listTeamsAll, currentUser, type Team } from "@/lib/api";
import { computeLens } from "@/lib/lens";

// Quadro de SUBTIME (Fatia 7a). Le o teamId da URL e passa como subteamId
// pro Board (modo hibrido: compartilhadas da raiz + internas do subtime).
// O titulo mostra o NOME do time, nao o UUID.
//
// Guardas de rota:
//   - id inexistente -> avisa "time nao encontrado".
//   - id da RAIZ      -> avisa que o lugar dela e o quadro geral.
//   - id FORA da lente do usuario -> avisa "sem acesso" em vez de renderizar
//     um quadro (que, por um subtime alheio, viria quase vazio e ainda
//     convidaria a "criar a primeira tarefa" numa area que nao e sua). O dado
//     ja e protegido pelo backend; isto fecha o furo de UX. A lente e a MESMA
//     (computeLens) que monta as sub-abas do menu, entao nenhum link que o
//     usuario ve no AppShell e barrado aqui -- so ids digitados na mao.
export default function QuadroSubtimePage() {
  const params = useParams();
  const teamId = typeof params.teamId === "string" ? params.teamId : "";

  const [team, setTeam] = useState<Team | null>(null);
  const [temAcesso, setTemAcesso] = useState(false);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    Promise.all([listTeamsAll(), currentUser()])
      .then(([teams, me]) => {
        if (!vivo) return;
        const alvo = teams.find((t) => t.id === teamId) ?? null;
        setTeam(alvo);
        const lens = computeLens(me.teams, teams);
        setTemAcesso(alvo ? lens.visibleTeamIds.has(alvo.id) : false);
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
      ) : !temAcesso ? (
        // fora da lente -> nao e um quadro que este usuario deveria abrir.
        <div className="muted">
          Você não tem acesso ao quadro deste time. Volte ao{" "}
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
