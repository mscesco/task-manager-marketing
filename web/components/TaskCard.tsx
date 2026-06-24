"use client";
import { PRIORITY_LABEL, PRIORITY_COLOR } from "@/lib/status";
import type { Task } from "@/lib/api";
import { iniciais, nomeCurto, corAvatar } from "@/lib/people";

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
}: {
  task: Task;
  members?: Map<string, CardMember>; // resolve id -> nome (mapa memoizado do quadro)
  subtaskCount?: number; // filhos DIRETOS
  subtaskDone?: number; // filhos diretos concluidos
}) {
  const ids = task.assignee_ids ?? [];
  const mostra = ids.slice(0, MAX_BOLINHAS);
  const resto = ids.length - mostra.length;

  return (
    <div
      style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 8, padding: "10px 12px", boxShadow: "var(--shadow-card)",
        display: "flex", flexDirection: "column", gap: 8,
      }}
    >
      <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.35 }}>{task.title}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 999,
            color: PRIORITY_COLOR[task.priority] || "var(--text-soft)",
            background: (PRIORITY_COLOR[task.priority] || "#999") + "1a",
          }}
        >
          {PRIORITY_LABEL[task.priority] || task.priority}
        </span>
        {task.due_date && (
          <span className="muted" style={{ fontSize: 11.5 }}>
            ◷ {new Date(task.due_date).toLocaleDateString("pt-BR")}
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

        {ids.length > 0 && (
          <span style={{ display: "flex", alignItems: "center", marginLeft: "auto" }}>
            {mostra.map((id, i) => {
              const nome = members?.get(id)?.name ?? "";
              return (
                <span
                  key={id}
                  title={nome ? nomeCurto(nome) : "Responsavel"}
                  style={{
                    width: 20, height: 20, borderRadius: 999,
                    background: corAvatar(id), color: "#fff",
                    fontSize: 9.5, fontWeight: 700,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    border: "1.5px solid var(--surface)",
                    marginLeft: i === 0 ? 0 : -6,
                  }}
                >
                  {nome ? iniciais(nome) : "?"}
                </span>
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
