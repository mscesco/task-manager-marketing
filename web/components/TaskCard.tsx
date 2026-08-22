"use client";
import { FolderKanban, CornerDownRight, Calendar, CheckSquare, Columns3 } from "lucide-react";
import {
  PRIORITY_LABEL,
  PRIORITY_COLOR,
  DEADLINE_COLOR,
  paradaLabel,
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

// Selo do card: SO os responsaveis do proprio card (Entrega 10). Os das
// subtarefas vivem na sublista do modal -- nao sao agregados aqui (assignee
// e por task; a subtarefa e uma task separada). 2 bolinhas, depois "+N".
const MAX_BOLINHAS = 2;

// Spec 031 (C10): os selos usavam glifo Unicode (▦ ↳ ◷ ☑). Trocados por
// `lucide-react`, que ja e dependencia e ja desenha a navegacao do AppShell.
// Motivo: glifo nao e icone -- a forma muda com a fonte do sistema (no Windows
// varios caem no fallback), o tamanho nao e controlavel, e o leitor de tela
// anuncia o nome do caractere ("quadrado com preenchimento") no meio da frase.
// `aria-hidden` em todos: o texto ao lado ja diz o que e, e o `title` do span
// carrega o resto.
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
}: {
  task: Task;
  members?: Map<string, CardMember>; // resolve id -> nome (mapa memoizado do quadro)
  subtaskCount?: number; // filhos DIRETOS
  subtaskDone?: number; // filhos diretos concluidos
  projectName?: string; // nome do projeto p/ a tag (so no quadro geral)
  /**
   * Fatia 5b-5b: `Quadro · Coluna` quando a tarefa mora em outro quadro que o
   * desenhado pela tela; so o nome da coluna quando mora neste.
   *
   * ⚠️ SO AS TELAS TRANSVERSAIS PASSAM (`/minhas-tarefas`). No quadro o card
   * ja esta DENTRO da coluna dele e repetir o nome seria ruido -- por isso e
   * opcional, e nao um campo derivado de `coluna.name` aqui dentro.
   *
   * ⚠️ `undefined` (nao passou) e diferente de `null` (passou e nao sabe): o
   * primeiro nao desenha nada, o segundo cai na reserva de quem chama.
   */
  rotuloDaColuna?: string | null;
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
  /**
   * A coluna em que esta tarefa esta (fatia 4c). **OBRIGATORIA de proposito.**
   *
   * ⚠️ As duas regras visuais deste card -- cor do prazo e selo de "parada ha
   * X dias" -- decidiam por `task.status` e passaram a decidir pela COLUNA
   * (ADR 0040). Prop opcional com reserva nas funcoes antigas teria migrado a
   * tela aos poucos, e o preco seria as duas regras vivas ao mesmo tempo, sem
   * ninguem sabendo qual roda onde. Obrigatoria, o `tsc` lista todos os usos
   * de uma vez -- que e exatamente o que faltou na fatia 3, onde um `as` numa
   * fixture calou o compilador e o buraco durou horas.
   *
   * Quem chama resolve por `task.column_id` no mapa de colunas do quadro.
   */
  coluna: Coluna;
}) {
  const ids = task.assignee_ids ?? [];
  const mostra = ids.slice(0, MAX_BOLINHAS);
  const resto = ids.length - mostra.length;
  const dueTone = deadlineTonePorColuna(coluna, task.due_date, task.is_archived, task.due_time);
  // Spec 031 / C2. `updated_at` ja vem no payload da listagem -- custo zero de
  // rede. Ver o aviso sobre o que ele NAO mede em lib/status.ts.
  const parada = diasParadoPorColuna(coluna, task.updated_at, task.is_archived);
  const semResponsavel = ids.length === 0;

  return (
    <div
      // ⚠️ ANCORA ESTAVEL DO CARD, e nao um `data-testid`. Os testes de
      // montagem subiam do titulo com `parentElement` -- o comentario do helper
      // dizia que isso "quebra alto se a estrutura mudar, que e o comportamento
      // desejado". Quebrou: mover os responsaveis para a linha do titulo pos um
      // `<div>` no meio e derrubou SEIS testes que nao tinham nada a ver com a
      // mudanca. Quebrar alto e bom; quebrar por contagem de niveis so ensina a
      // ajustar o numero. Com a ancora, o teste continua achando o card e passa
      // a quebrar so quando o CARD sumir.
      data-card={task.id}
      style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 8, padding: "10px 12px", boxShadow: "var(--shadow-card)",
        display: "flex", flexDirection: "column", gap: 8,
      }}
    >
      {/* Spec 039 (F1): título de card = 13px / 600. O `13.5` era meio-pixel,
          que a Spec 018 §4 tinha matado e voltou por inércia. */}
      {/* ⚠️ `overflowWrap: "anywhere"` -- SEM ELE UMA PALAVRA LONGA ESTOURA O
          CARD. Título é texto de usuário, e texto de usuário não tem contrato:
          "JDHWEIGUAWKLVIUWEIUJQJWFKQEFJLJWEFLQJNEVOMEV" não tem espaço nem
          hífen, então não existe ponto de quebra natural e a palavra empurra a
          largura. Medido na tela em 21/08: card de 182px com 387px de conteúdo
          -- 205px de excesso, e barra de rolagem DENTRO do card.
          O `TaskDetail` já fazia isso na descrição, pelo mesmo motivo; o card
          ficou de fora. É a regra "resiliente a conteúdo de usuário" do
          `web/AGENTS.md`, e ela não tem portão: nenhum teste mede largura. */}
      {/* ⚠️ OS RESPONSAVEIS SOBEM PARA A LINHA DO TITULO (21/08). Eles moravam
          na linha de meta, com `marginLeft: auto` dentro de um `flexWrap`:
          quando prioridade + data + checklist + avatares nao cabiam nos ~216px
          uteis do card -- e a conta dava ~238 --, eles quebravam para uma
          SEGUNDA linha, sozinhos e colados a direita. Lia como defeito, e era
          intermitente: dependia do tamanho da data e de haver checklist.

          Aqui o lugar deles e FIXO em todo card, a altura nao cresce, e a
          linha de meta perde ~55px e para de quebrar.

          ⚠️ `min-w-0` no titulo e obrigatorio: sem ele um filho de flex NAO
          encolhe abaixo do proprio conteudo, e o titulo empurraria os avatares
          para fora em vez de quebrar. Mesma armadilha que o `web/AGENTS.md`
          registra. */}
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
            {new Date(task.due_date + "T00:00:00").toLocaleDateString("pt-BR")}
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

        {/* Spec 031 / C2: ausencia de responsavel precisa ser DITA. Um card
            sem bolinha nenhuma nao le como "falta alguem", le como nada --
            e sao 44 tarefas nesse estado hoje. Tom neutro de proposito: e
            pendencia de preenchimento, nao erro. */}
        {semResponsavel && (
          <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>
            sem responsável
          </span>
        )}

      </div>
    </div>
  );
}
