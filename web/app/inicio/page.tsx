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
//
// FILTROS (14/10, pedido da chefe dela: "filtrar por time e por pessoa"):
// - SUBTIME: a barra escolhe o time raiz; aqui se desce a um subtime dele;
// - PESSOA: o relatório INTEIRO passa a ser daquela pessoa (só a fila de
//   solicitações não muda -- ver `DashboardService.build`);
// - só aparecem para quem vê a carga (a resposta traz `workload`), e o
//   servidor recusa o filtro de pessoa para os outros;
// - moram na URL (`?subtime=`, `?pessoa=`), lidos por `window.location`, e
//   não por `useSearchParams` -- o mesmo cuidado da Base com o build.

import { useCallback, useEffect, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import TeamDashboard from "@/components/TeamDashboard";
import Loading from "@/components/Loading";
import FilterPicker from "@/components/FilterPicker";
import {
  ApiError,
  getDashboard,
  listMembersDoTime,
  listTeamsAll,
  type DashboardResponse,
  type Member,
  type Team,
} from "@/lib/api";
import { navHref } from "@/lib/activeTeam";
import { useActiveTeam, useActiveTeamId } from "@/lib/useActiveTeam";

const SUBTEAM_PARAM = "subtime";
const PERSON_PARAM = "pessoa";

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

  // --- os filtros ---
  const [subteamId, setSubteamId] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [filtersRead, setFiltersRead] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setSubteamId(q.get(SUBTEAM_PARAM));
    setPersonId(q.get(PERSON_PARAM));
    setFiltersRead(true);
  }, []);
  function writeFilters(subteam: string | null, person: string | null) {
    setSubteamId(subteam);
    setPersonId(person);
    const url = new URL(window.location.href);
    if (subteam) url.searchParams.set(SUBTEAM_PARAM, subteam);
    else url.searchParams.delete(SUBTEAM_PARAM);
    if (person) url.searchParams.set(PERSON_PARAM, person);
    else url.searchParams.delete(PERSON_PARAM);
    window.history.replaceState(null, "", url);
  }

  // As opções: os subtimes do time da barra e quem alcança esse time.
  const [subteams, setSubteams] = useState<Team[]>([]);
  const [people, setPeople] = useState<Member[]>([]);
  useEffect(() => {
    if (!teamId) {
      setSubteams([]);
      setPeople([]);
      return;
    }
    let alive = true;
    Promise.all([listTeamsAll(), listMembersDoTime(teamId)])
      .then(([teams, members]) => {
        if (!alive) return;
        setSubteams(
          teams
            .filter((t) => t.parent_team_id === teamId)
            .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
        );
        setPeople(
          members
            .filter((m) => m.is_active)
            .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [teamId]);

  // ⚠️ Trocar o time na BARRA zera o subtime: ele era de outra árvore.
  const lastTeam = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!filtersRead || active === null) return;
    if (lastTeam.current !== undefined && lastTeam.current !== teamId) {
      writeFilters(null, personId);
    }
    lastTeam.current = teamId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, filtersRead, active === null]);

  const scope = subteamId ?? teamId;

  // ⚠️ GUARDA DE CORRIDA: trocar de time ou de filtro com um pedido em voo
  // não pode deixar os números anteriores na tela.
  const latest = useRef(0);
  const load = useCallback(() => {
    const n = ++latest.current;
    getDashboard(scope, personId)
      .then((d) => {
        if (n !== latest.current) return;
        setData(d);
        setError(null);
      })
      .catch((e: ApiError) => {
        if (n === latest.current) setError(e.message || "Não consegui carregar o painel.");
      });
  }, [scope, personId]);

  useEffect(() => {
    if (active === null || !filtersRead) return;
    load();
    // ⚠️ `active === null` e não `active`: o objeto é novo a cada render da
    // barra (o defeito de 14/09 em "Minhas tarefas").
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, personId, filtersRead, active === null]);

  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden && active !== null) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load, active]);

  const person = people.find((p) => p.id === personId) ?? null;
  // Os filtros são de quem vê a carga -- ou de quem já chegou com um na URL.
  const showFilters = !!data && (data.workload !== null || !!personId || !!subteamId);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={teamName ? `Início · ${teamName}` : "Início"}
        actions={
          showFilters ? (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {subteams.length > 0 && (
                <FilterPicker
                  label="Subtime"
                  value={subteamId}
                  allLabel="Todos os subtimes"
                  options={subteams.map((t) => ({ id: t.id, name: t.name }))}
                  onChange={(v) => writeFilters(v, personId)}
                />
              )}
              <FilterPicker
                label="Pessoa"
                value={personId}
                allLabel="Todas as pessoas"
                options={people.map((p) => ({ id: p.id, name: p.name }))}
                people
                onChange={(v) => writeFilters(subteamId, v)}
              />
            </div>
          ) : undefined
        }
      />
      {error ? (
        <div className="error-box" role="alert">
          {error}
        </div>
      ) : data === null ? (
        <Loading />
      ) : (
        <TeamDashboard
          data={data}
          personName={person?.name ?? null}
          onPickPerson={data.workload !== null ? (id) => writeFilters(subteamId, id) : undefined}
          links={{
            mine: navHref("/minhas-tarefas", active),
            queue: navHref("/solicitacoes", active),
          }}
        />
      )}
    </div>
  );
}
