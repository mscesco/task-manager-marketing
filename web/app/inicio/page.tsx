"use client";
// A tela inicial do time. Espera a barra resolver o time (`active === null`),
// senão traria os números da organização inteira por um instante. Sem ao vivo:
// recarrega ao abrir e ao voltar para a aba.
//
// Filtros (subtime, pessoa, período) moram na URL (`?subtime=`, `?pessoa=`,
// `?de=`, `?ate=`), lidos por `window.location` e não por `useSearchParams`, que
// quebraria o build. Subtime e pessoa só para quem vê a carga (`workload`); o
// período vale para todos e sobrevive à troca de time.

import { useCallback, useEffect, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import TeamDashboard from "@/components/TeamDashboard";
import Loading from "@/components/Loading";
import FilterPicker from "@/components/FilterPicker";
import PeriodPicker from "@/components/PeriodPicker";
import ExportMenu from "@/components/ExportMenu";
import {
  ApiError,
  exportDashboard,
  getDashboard,
  listMembersDoTime,
  listTeamsAll,
  type DashboardResponse,
  type Member,
  type Team,
} from "@/lib/api";
import { navHref } from "@/lib/activeTeam";
import { useActiveTeam, useActiveTeamId } from "@/lib/useActiveTeam";
import { isIsoDay, periodLabel, type Period } from "@/lib/teamDashboard";

const SUBTEAM_PARAM = "subtime";
const PERSON_PARAM = "pessoa";
const START_PARAM = "de";
const END_PARAM = "ate";

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
  // O "hoje" do servidor, guardado: os filtros ficam na tela enquanto um
  // filtro novo carrega (sem ele, sumiam e voltavam a cada troca).
  const [today, setToday] = useState<string | null>(null);
  const [managerSeen, setManagerSeen] = useState(false);

  // --- os filtros ---
  const [subteamId, setSubteamId] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period | null>(null);
  const [filtersRead, setFiltersRead] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setSubteamId(q.get(SUBTEAM_PARAM));
    setPersonId(q.get(PERSON_PARAM));
    // Período da URL só se as duas datas valem e estão em ordem; senão, "Agora".
    const de = q.get(START_PARAM);
    const ate = q.get(END_PARAM);
    if (isIsoDay(de) && isIsoDay(ate) && de <= ate) setPeriod({ start: de, end: ate });
    setFiltersRead(true);
  }, []);
  function writePeriod(p: Period | null) {
    setPeriod(p);
    const url = new URL(window.location.href);
    if (p) {
      url.searchParams.set(START_PARAM, p.start);
      url.searchParams.set(END_PARAM, p.end);
    } else {
      url.searchParams.delete(START_PARAM);
      url.searchParams.delete(END_PARAM);
    }
    window.history.replaceState(null, "", url);
  }
  const periodKey = period ? `${period.start}/${period.end}` : "";
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
  // As listas chegaram para este time: só então dá para dizer que um filtro da URL não serve.
  const [optionsFor, setOptionsFor] = useState<string | null>(null);
  useEffect(() => {
    if (!teamId) {
      setSubteams([]);
      setPeople([]);
      setOptionsFor(null);
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
        setOptionsFor(teamId);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [teamId]);

  // Trocar o time na barra zera os dois filtros: subtime e pessoa eram da outra árvore.
  const lastTeam = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!filtersRead || active === null) return;
    if (lastTeam.current !== undefined && lastTeam.current !== teamId) {
      writeFilters(null, null);
    }
    lastTeam.current = teamId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, filtersRead, active === null]);

  // Filtro da URL que não é deste time sai, em vez de a tela dizer "Todos" sobre números filtrados.
  useEffect(() => {
    if (optionsFor === null || optionsFor !== teamId) return;
    const subOk = !subteamId || subteams.some((t) => t.id === subteamId);
    const personOk = !personId || people.some((p) => p.id === personId);
    if (!subOk || !personOk) writeFilters(subOk ? subteamId : null, personOk ? personId : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsFor, teamId, subteams, people]);

  const scope = subteamId ?? teamId;

  // Guarda de corrida: um pedido em voo não pode deixar os números anteriores na tela.
  const latest = useRef(0);
  const load = useCallback(() => {
    const n = ++latest.current;
    getDashboard(scope, personId, period)
      .then((d) => {
        if (n !== latest.current) return;
        setData(d);
        setToday(d.today);
        setManagerSeen(d.workload !== null);
        setError(null);
      })
      .catch((e: ApiError) => {
        if (n === latest.current) setError(e.message || "Não consegui carregar o painel.");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, personId, periodKey]);

  useEffect(() => {
    if (active === null || !filtersRead) return;
    // Filtro novo, números novos: sem limpar, o rótulo trocaria sobre os números antigos.
    setData(null);
    setError(null);
    load();
    // `active === null`, não `active`: o objeto é novo a cada render da barra.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, personId, periodKey, filtersRead, active === null]);

  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden && active !== null) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load, active]);

  const person = people.find((p) => p.id === personId) ?? null;
  // Os filtros são de quem vê a carga. O de PESSOA só para ela: o servidor o
  // recusa para os outros (403).
  const manager = managerSeen;
  const hasFilter = !!personId || !!subteamId || !!period;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={teamName ? `Início · ${teamName}` : "Início"}
        actions={
          today ? (
            <div className="ml-auto flex flex-wrap items-center gap-2 print:hidden">
              {/* O período vale para todos -- não depende de ver a carga. */}
              <PeriodPicker value={period} today={today} onChange={writePeriod} />
              {(manager || subteamId) && subteams.length > 0 && (
                <FilterPicker
                  label="Subtime"
                  value={subteamId}
                  allLabel="Todos os subtimes"
                  options={subteams.map((t) => ({ id: t.id, name: t.name }))}
                  onChange={(v) => writeFilters(v, personId)}
                />
              )}
              {manager && (
                <FilterPicker
                  label="Pessoa"
                  value={personId}
                  allLabel="Todas as pessoas"
                  options={people.map((p) => ({ id: p.id, name: p.name }))}
                  people
                  onChange={(v) => writeFilters(subteamId, v)}
                />
              )}
              <ExportMenu
                onSpreadsheet={() => exportDashboard(scope, personId, period)}
              />
            </div>
          ) : undefined
        }
      />
      {/* Só no PDF: os filtros viram uma linha de texto. */}
      {today && (
        <p className="m-0 hidden text-sm text-ink-soft print:block">
          {periodLabel(period, today)}
          {subteamId && ` · ${subteams.find((t) => t.id === subteamId)?.name ?? ""}`}
          {person && ` · ${person.name}`}
          {` · gerado em ${today.slice(8, 10)}/${today.slice(5, 7)}/${today.slice(0, 4)}`}
        </p>
      )}
      {error ? (
        // Com filtro, o erro tem saída: um `?pessoa=` aberto por quem não pode
        // filtrar (403) prenderia a tela numa caixa de erro.
        <div className="error-box flex flex-wrap items-center gap-3" role="alert">
          <span>{error}</span>
          {hasFilter && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                writeFilters(null, null);
                writePeriod(null);
              }}
            >
              Limpar filtros
            </button>
          )}
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
