"use client";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import Badge from "@/components/Badge";
import EmptyState from "@/components/EmptyState";
import Card from "@/components/Card";
import PageHeader from "@/components/PageHeader";
import { Esqueleto } from "@/components/Loading";
import Entrada from "@/components/Entrada";
import { useActiveTeam, useActiveTeamId } from "@/lib/useActiveTeam";
import { CalendarClock, Plus } from "lucide-react";
import { dataParaTela } from "@/lib/baseTable";
import { diaNoWorkspace } from "@/lib/prazo";
import {
  listProjects,
  createProject,
  currentUser,
  listTeamsAll,
  ApiError,
  type Project,
  type ProjectStatus,
  type Team,
} from "@/lib/api";
import { rootsForPerson } from "@/lib/contextSwitcher";
import { semMarcacao } from "@/lib/markdown";

import { PROJECT_STATUS, PROJECT_STATUS_COLOR, PROJECT_STATUS_LABEL } from "@/lib/status";

// Projeto e "pasta" -- tudo no time raiz, todos veem. Designar e so nas tasks.

export default function ProjetosPage() {
  return (
    <AppShell>
      <Projetos />
    </AppShell>
  );
}

function Projetos() {
  const [items, setItems] = useState<Project[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const [criando, setCriando] = useState(false);
  const [podeCriar, setPodeCriar] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("PLANNING");
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);
  // Time raiz do projeto: com mais de um, a pessoa escolhe (adivinhar criaria no time errado).
  const [roots, setRoots] = useState<Team[]>([]);
  const [rootId, setRootId] = useState<string>("");

  // Time ativo vem da barra: `useSearchParams` aqui quebraria o build da rota estática.
  const timeAtivo = useActiveTeamId();
  // `active === null` = barra não resolveu; `kind: "none"` = resolveu sem time.
  // O nome vem da barra (`teamName`), a mesma árvore que resolveu o time ativo.
  const { active, teamName: nomeDoTime } = useActiveTeam();

  useEffect(() => {
    // Espera a barra resolver; buscar antes mostraria projetos de todos os times por um instante.
    if (active === null) return;
    listProjects({ size: 100, teamId: timeAtivo })
      .then((r) => setItems(r.items))
      .catch((e: ApiError) => setErro(e.message));
    // `active === null`, não `active`: o objeto é novo a cada render e refaria o pedido.
  }, [timeAtivo, active === null]);

  useEffect(() => {
    // `rootsForPerson` precisa da árvore e dos vínculos de quem olha.
    Promise.all([currentUser(), listTeamsAll()])
      .then(([me, times]) => {
        // Só os times em que ela cria (`can_create_project`, decidido pelo servidor).
        const minhas = rootsForPerson(
          times,
          me,
          (me.org_role ?? null) !== null,
        ).filter((t) => t.can_create_project === true);
        setPodeCriar(minhas.length > 0);
        setRoots(minhas);
        // Com um time só, pré-seleciona e o campo nem aparece.
        if (minhas.length === 1) setRootId(minhas[0].id);
      })
      .catch(() => {});
  }, []);

  // O time ativo preenche o campo, sem sobrescrever uma escolha já feita.
  useEffect(() => {
    if (!timeAtivo) return;
    setRootId((atual) => atual || timeAtivo);
  }, [timeAtivo]);

  async function criar() {
    const t = titulo.trim();
    if (!t || !rootId) return;
    setSalvando(true);
    setErroForm(null);
    try {
      const novo = await createProject({ title: t, status, team_id: rootId });
      // Só entra na lista se for do time mostrado (`rootId` é sempre raiz).
      if (timeAtivo === null || rootId === timeAtivo) {
        setItems((prev) => [novo, ...(prev ?? [])]);
      }
      setTitulo("");
      setStatus("PLANNING");
      setCriando(false);
    } catch (e) {
      setErroForm((e as ApiError).message || "Não consegui criar o projeto.");
    } finally {
      setSalvando(false);
    }
  }

  if (erro) return <div className="error-box" style={{ maxWidth: 480 }}>{erro}</div>;
  if (!items) return <Esqueleto forma="linhas" rotulo="Carregando projetos" />;

  return (
    <div>
      <PageHeader
        title="Projetos"
        /* O nome do time diz que a lista está recortada. */
        count={
          nomeDoTime
            ? `${items.length} projetos em ${nomeDoTime}`
            : `${items.length} projetos`
        }
        actions={
          podeCriar && !criando && (
            <button type="button" className="btn btn-primary ml-auto" onClick={() => setCriando(true)}>
              + Novo projeto
            </button>
          )
        }
      />

      {criando && (
        <Card className="mb-[18px] flex max-w-[860px] flex-col gap-3">
          <div className="field">
            <span className="label">Título do projeto</span>
            <input
              className="input"
              autoFocus
              placeholder="Ex.: Campanha Q3"
              value={titulo}
              maxLength={255}
              disabled={salvando}
              onChange={(e) => setTitulo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  criar();
                } else if (e.key === "Escape") {
                  setCriando(false);
                  setTitulo("");
                }
              }}
            />
          </div>
          <div className="field">
            <span className="label">Status</span>
            <select
              className="input"
              value={status}
              disabled={salvando}
              onChange={(e) => setStatus(e.target.value as ProjectStatus)}
            >
              {PROJECT_STATUS.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </div>
          {/* Só com dois ou mais times; com um, o valor já está escolhido. */}
          {roots.length > 1 && (
            <div className="field">
              <span className="label">Time</span>
              {/* O "Time" acima é um `<span>`: o nome acessível vem do `aria-label`. */}
              <select
                className="input"
                aria-label="Time do projeto"
                value={rootId}
                disabled={salvando}
                onChange={(e) => setRootId(e.target.value)}
              >
                {/* Opção vazia primeiro: nada pré-marcado; o botão fica desligado até escolher. */}
                <option value="">— escolha o time —</option>
                {roots.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          )}
          {erroForm && <div className="error-box">{erroForm}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button
              type="button" className="btn btn-ghost" disabled={salvando}
              onClick={() => { setCriando(false); setTitulo(""); setErroForm(null); }}
            >
              Cancelar
            </button>
            <button
              type="button" className="btn btn-primary"
              disabled={salvando || !titulo.trim() || !rootId}
              onClick={criar}
            >
              {salvando ? "Criando…" : "Criar projeto"}
            </button>
          </div>
        </Card>
      )}

      {items.length === 0 ? (
        <EmptyState
          title={
            nomeDoTime ? `Nenhum projeto em ${nomeDoTime}` : "Nenhum projeto ainda"
          }
          description="Crie um projeto para agrupar tarefas de um trabalho maior."
          action={
            podeCriar && (
              <button type="button" className="btn btn-primary" onClick={() => setCriando(true)}>
                + Novo projeto
              </button>
            )
          }
        />
      ) : (
        /* Sem progresso nem avatares: a lista de projetos não traz esses dados. */
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
          <Entrada>
            {items.map((p) => (
              <CartaoDeProjeto key={p.id} p={p} />
            ))}
          </Entrada>
          {podeCriar && !criando && (
            <button
              type="button"
              onClick={() => setCriando(true)}
              className="flex min-h-[150px] flex-col items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-border bg-transparent text-sm font-semibold text-ink-faint transition-colors duration-200 hover:border-accent hover:bg-accent-soft hover:text-accent"
            >
              <Plus size={22} aria-hidden />
              Novo projeto
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Um card da grade de projetos. */
function CartaoDeProjeto({ p }: { p: Project }) {
  const resumo = p.description?.trim() ? semMarcacao(p.description) : "";
  return (
    <a
      href={`/projetos/${p.id}`}
      className="flex min-h-[150px] flex-col gap-3 rounded-xl border border-border bg-surface p-[18px] text-ink no-underline transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--glow)]"
      // Só a cor do filete é inline: vem do status.
      style={{ borderTop: `3px solid ${PROJECT_STATUS_COLOR[p.status] || "var(--border)"}` }}
    >
      <span className="flex items-start gap-2.5">
        {/* `min-w-0` + truncagem: nome longo nao empurra o selo para fora. */}
        <strong className="min-w-0 flex-1 text-md font-bold leading-snug [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
          {p.title}
        </strong>
        <Badge tone="soft" size="sm" color={PROJECT_STATUS_COLOR[p.status]} className="shrink-0">
          {PROJECT_STATUS_LABEL[p.status] || p.status}
        </Badge>
      </span>
      {/* Resumo sem marcação: `**` e `##` numa linha cortada parecem defeito. */}
      {resumo && (
        <span
          className="muted text-sm leading-snug [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden"
          title={resumo}
        >
          {resumo}
        </span>
      )}
      <span className="mt-auto flex items-center gap-3 text-xs text-ink-faint">
        {p.due_date && (
          <span className="inline-flex items-center gap-1">
            <CalendarClock size={12} aria-hidden />
            até {dataParaTela(p.due_date)}
          </span>
        )}
        <span className="ml-auto">atualizado em {dataParaTela(diaNoWorkspace(p.updated_at))}</span>
      </span>
    </a>
  );
}
