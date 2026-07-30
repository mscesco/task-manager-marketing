"use client";
import {
  PRIORITY_LABEL,
  PRIORITY_COLOR,
  deadlineTone,
  DEADLINE_COLOR,
  diasParado,
  paradaLabel,
} from "@/lib/status";
import Badge from "@/components/Badge";
import Avatar from "@/components/Avatar";
import type { Task } from "@/lib/api";
import { nomeCurto } from "@/lib/people";

// Selo do card: SO os responsaveis do proprio card (Entrega 10). Os das
// subtarefas vivem na sublista do modal -- nao sao agregados aqui (assignee
// e por task; a subtarefa e uma task separada). 2 bolinhas, depois "+N".
const MAX_BOLINHAS = 2;

type CardMember = { name: string };

export default function TaskCard({
  task,
  members,
  subtaskCount = 0,
  subtaskDone = 0,
  projectName,
  parentTitle,
  escopo,
}: {
  task: Task;
  members?: Map<string, CardMember>; // resolve id -> nome (mapa memoizado do quadro)
  subtaskCount?: number; // filhos DIRETOS
  subtaskDone?: number; // filhos diretos concluidos
  projectName?: string; // nome do projeto p/ a tag (so no quadro geral)
  /**
   * Titulo da tarefa-mae. So "Minhas tarefas" passa: e a unica tela que
   * mostra subtarefa como card SOLTO -- no quadro geral ela vive dentro do
   * card da mae (ADR 0004) e o contexto ja e obvio.
   */
  parentTitle?: string | null;
  // Fatia 4b: origem da task no quadro de SUBTIME. "compartilhada" = veio
  // da raiz (responsavel do subtime); "interna" = nasceu no subtime.
  // undefined em outros quadros (nao mostra pill).
  escopo?: "compartilhada" | "interna";
}) {
  const ids = task.assignee_ids ?? [];
  const mostra = ids.slice(0, MAX_BOLINHAS);
  const resto = ids.length - mostra.length;
  const dueTone = deadlineTone(task.due_date, task.status, task.is_archived);
  // Spec 031 / C2. `updated_at` ja vem no payload da listagem -- custo zero de
  // rede. Ver o aviso sobre o que ele NAO mede em lib/status.ts.
  const parada = diasParado(task.updated_at, task.status, task.is_archived);
  const semResponsavel = ids.length === 0;

  return (
    <div
      style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 8, padding: "10px 12px", boxShadow: "var(--shadow-card)",
        display: "flex", flexDirection: "column", gap: 8,
      }}
    >
      <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.35 }}>{task.title}</div>
      {projectName && (
        <span
          title={`Projeto: ${projectName}`}
          style={{
            alignSelf: "flex-start", maxWidth: "100%",
            fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6,
            background: "var(--surface-2)", color: "var(--text-soft)",
            border: "1px solid var(--border)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}
        >
          ▦ {projectName}
        </span>
      )}
      {parentTitle && (
        <span
          title={`Subtarefa de: ${parentTitle}`}
          style={{
            alignSelf: "flex-start", maxWidth: "100%",
            fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6,
            background: "var(--surface-2)", color: "var(--text-soft)",
            border: "1px solid var(--border)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}
        >
          ↳ {parentTitle}
        </span>
      )}
      {escopo && (
        <span
          title={
            escopo === "compartilhada"
              ? "Tarefa do quadro geral (responsável deste subtime)"
              : "Tarefa interna deste subtime"
          }
          style={{
            alignSelf: "flex-start",
            fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6,
            background:
              escopo === "compartilhada" ? "var(--accent-soft)" : "var(--surface-2)",
            color:
              escopo === "compartilhada" ? "var(--accent)" : "var(--text-soft)",
            border: "1px solid var(--border)",
          }}
        >
          {escopo === "compartilhada" ? "Compartilhada" : "Interna"}
        </span>
      )}
      {parada !== null && (
        <span
          title="Sem mudança de status, título ou prazo. Comentário e designação não contam."
          style={{
            alignSelf: "flex-start",
            display: "inline-flex", alignItems: "center", gap: 5,
            fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6,
            color: "var(--stale-text)",
            background: "color-mix(in srgb, var(--stale-text) 12%, transparent)",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 6, height: 6, borderRadius: 999,
              background: "var(--stale-dot)", flexShrink: 0,
            }}
          />
          {paradaLabel(parada)}
        </span>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Badge tone="soft" size="sm" color={PRIORITY_COLOR[task.priority]}>
          {PRIORITY_LABEL[task.priority] || task.priority}
        </Badge>
        {task.due_date && (
          <span
            className={dueTone ? undefined : "muted"}
            style={{
              fontSize: 11.5,
              color: dueTone ? DEADLINE_COLOR[dueTone] : undefined,
              fontWeight: dueTone ? 600 : undefined,
            }}
          >
            ◷ {new Date(task.due_date + "T00:00:00").toLocaleDateString("pt-BR")}
          </span>
        )}
        {subtaskCount > 0 && (
          <span
            className="muted"
            title={`${subtaskDone} de ${subtaskCount} subtarefas concluidas`}
            style={{ fontSize: 11.5 }}
          >
            ☑ {subtaskDone}/{subtaskCount}
          </span>
        )}
        {task.is_archived && (
          <span className="muted" style={{ fontSize: 11.5 }}>arquivada</span>
        )}

        {/* Spec 031 / C2: ausencia de responsavel precisa ser DITA. Um card
            sem bolinha nenhuma nao le como "falta alguem", le como nada --
            e sao 44 tarefas nesse estado hoje. Tom neutro de proposito: e
            pendencia de preenchimento, nao erro. */}
        {semResponsavel && (
          <span className="muted" style={{ fontSize: 11.5, marginLeft: "auto" }}>
            sem responsável
          </span>
        )}

        {ids.length > 0 && (
          <span style={{ display: "flex", alignItems: "center", marginLeft: "auto" }}>
            {mostra.map((id, i) => {
              const nome = members?.get(id)?.name ?? "";
              return (
                <Avatar
                  key={id}
                  id={id}
                  name={nome}
                  size="sm"
                  title={nome ? nomeCurto(nome) : "Responsável"}
                  className="border-[1.5px] border-surface"
                  style={{ marginLeft: i === 0 ? 0 : -6 }}
                />
              );
            })}
            {resto > 0 && (
              <span
                className="muted"
                style={{ fontSize: 11, fontWeight: 700, marginLeft: 4 }}
              >
                +{resto}
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
