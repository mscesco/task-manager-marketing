"use client";
import { FolderKanban, CornerDownRight, Calendar, CheckSquare, Columns3 } from "lucide-react";
import {
  PRIORITY_LABEL,
  PRIORITY_COLOR,
  DEADLINE_COLOR,
  paradaLabel,
  dataHoraBR,
} from "@/lib/status";
import {
  deadlineTonePorColuna,
  diasParadoPorColuna,
  type Coluna,
} from "@/lib/coluna";
import Badge from "@/components/Badge";
import Avatar from "@/components/Avatar";
import type { Task } from "@/lib/api";
import { nomeCurto } from "@/lib/people";

// Só os responsáveis do próprio card (os das subtarefas não entram): 2 bolinhas, depois "+N".
const MAX_BOLINHAS = 2;

// Ícones `aria-hidden`: o texto ao lado já diz o que é, e o `title` do span carrega o resto.
const ICONE = { size: 12, strokeWidth: 2, "aria-hidden": true as const };

type CardMember = { name: string };

export default function TaskCard({
  task,
  members,
  subtaskCount = 0,
  subtaskDone = 0,
  projectName,
  rotuloDaColuna,
  parentTitle,
  escopo,
  coluna,
  travado = false,
}: {
  task: Task;
  /** Modo de edição de colunas: o card não arrasta e perde a sombra, mas continua à vista. */
  travado?: boolean;
  members?: Map<string, CardMember>; // resolve id -> nome (mapa memoizado do quadro)
  subtaskCount?: number; // filhos DIRETOS
  subtaskDone?: number; // filhos diretos concluidos
  projectName?: string; // nome do projeto p/ a tag (so no quadro geral)
  /**
   * `Quadro · Coluna` quando a tarefa mora em outro quadro; só a coluna quando mora neste.
   * Só as telas transversais passam. `undefined` não desenha nada; `null` cai na reserva de quem chama.
   */
  rotuloDaColuna?: string | null;
  /** Título da tarefa-mãe; só "Minhas tarefas" passa (lá a subtarefa aparece como card solto). */
  parentTitle?: string | null;
  // Origem da task no quadro de subtime: "compartilhada" veio da raiz, "interna" nasceu no subtime.
  // undefined em outros quadros (não mostra pill).
  escopo?: "compartilhada" | "interna";
  /**
   * A coluna em que a tarefa está; cor do prazo e selo de "parada há X dias" decidem por ela.
   * Quem chama resolve por `task.column_id` no mapa de colunas do quadro.
   */
  coluna: Coluna;
}) {
  const ids = task.assignee_ids ?? [];
  const mostra = ids.slice(0, MAX_BOLINHAS);
  const resto = ids.length - mostra.length;
  const dueTone = deadlineTonePorColuna(coluna, task.due_date, task.is_archived, task.due_time);
  // Ver o aviso sobre o que `updated_at` não mede em lib/status.ts.
  const parada = diasParadoPorColuna(coluna, task.updated_at, task.is_archived);
  const semResponsavel = ids.length === 0;

  return (
    <div
      // Âncora estável do card para os testes, em vez de subir por `parentElement`.
      data-card={task.id}
      // Só a cor do filete é inline, porque vem da coluna.
      className="card-stripe"
      style={{
        background: "var(--surface)", borderTopColor: coluna.color,
        borderRadius: 10, padding: "12px 12px 10px",
        // No modo de edição o card perde só a sombra; o fundo segue `--surface`, backdrop dos selos cromáticos.
        boxShadow: travado ? "none" : "var(--shadow-card)",
        display: "flex", flexDirection: "column", gap: 8,
      }}
    >
      {/* `overflowWrap: "anywhere"`: título sem espaço estouraria o card. Os responsáveis
          ficam na linha do título para a linha de meta não quebrar; `min-w-0` deixa o título encolher. */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            fontWeight: 600,
            lineHeight: 1.35,
            overflowWrap: "anywhere",
          }}
        >
          {task.title}
        </div>
        {ids.length > 0 && (
          <span
            style={{
              display: "flex",
              alignItems: "center",
              flexShrink: 0,
              marginTop: 1,
            }}
          >
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
      {projectName && (
        <span
          title={`Projeto: ${projectName}`}
          style={{
            alignSelf: "flex-start", maxWidth: "100%",
            fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 6,
            background: "var(--surface-2)", color: "var(--text-soft)",
            border: "1px solid var(--border)",
            display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0,
            overflow: "hidden", whiteSpace: "nowrap",
          }}
        >
          <FolderKanban {...ICONE} style={{ flexShrink: 0 }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {projectName}
          </span>
        </span>
      )}
      {parentTitle && (
        <span
          title={`Subtarefa de: ${parentTitle}`}
          style={{
            alignSelf: "flex-start", maxWidth: "100%",
            fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 6,
            background: "var(--surface-2)", color: "var(--text-soft)",
            border: "1px solid var(--border)",
            display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0,
            overflow: "hidden", whiteSpace: "nowrap",
          }}
        >
          <CornerDownRight {...ICONE} style={{ flexShrink: 0 }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {parentTitle}
          </span>
        </span>
      )}
      {rotuloDaColuna && (
        <span
          title={`Coluna: ${rotuloDaColuna}`}
          style={{
            alignSelf: "flex-start", maxWidth: "100%",
            fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 6,
            background: "var(--surface-2)", color: "var(--text-soft)",
            border: "1px solid var(--border)",
            display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0,
            overflow: "hidden", whiteSpace: "nowrap",
          }}
        >
          <Columns3 {...ICONE} style={{ flexShrink: 0 }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {rotuloDaColuna}
          </span>
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
            fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 6,
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
            fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 6,
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
              display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: 11,
              color: dueTone ? DEADLINE_COLOR[dueTone] : undefined,
              fontWeight: dueTone ? 600 : undefined,
            }}
          >
            <Calendar {...ICONE} />
            {/* A hora aparece porque a cor do prazo já a considera. */}
            {dataHoraBR(task.due_date, task.due_time)}
          </span>
        )}
        {subtaskCount > 0 && (
          <span
            className="muted"
            title={`${subtaskDone} de ${subtaskCount} subtarefas concluídas`}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11 }}
          >
            <CheckSquare {...ICONE} />
            {subtaskDone}/{subtaskCount}
          </span>
        )}
        {task.is_archived && (
          <span className="muted" style={{ fontSize: 11 }}>arquivada</span>
        )}

        {/* Ausência de responsável dita; tom neutro: é pendência, não erro. */}
        {semResponsavel && (
          <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>
            sem responsável
          </span>
        )}

      </div>
    </div>
  );
}
