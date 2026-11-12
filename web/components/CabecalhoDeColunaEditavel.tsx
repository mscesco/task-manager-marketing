"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, BellOff, ChevronLeft, ChevronRight, GripVertical, Lock, X } from "lucide-react";

import type { LinhaDeEdicao } from "@/lib/rascunhoDeColunas";
import { ROTULO_DA_SEMANTICA } from "@/lib/edicaoDeColunas";
import { semanticaTerminal } from "@/lib/coluna";

/**
 * O cabeçalho de uma coluna no modo de edição: mesma anatomia do normal, com
 * os controles no lugar da contagem. Não fala com o servidor; só reporta
 * intenções para o rascunho do lote.
 */
export default function CabecalhoDeColunaEditavel({
  linha,
  cor,
  podeIrEsquerda,
  podeIrDireita,
  onRenomear,
  onMarcar,
  podeApagar,
  onTornarAlvo,
  onDesfazerAlvo,
  onAvisar,
  onMover,
  arrasteRef,
  arrasteProps,
}: {
  linha: LinhaDeEdicao;
  cor: string;
  podeIrEsquerda: boolean;
  podeIrDireita: boolean;
  onRenomear: (nome: string) => void;
  onMarcar: () => void;
  /**
   * Se a pessoa pode apagar coluna (o gestor edita e não apaga). Coluna ainda
   * não salva (`tmp:`) sai mesmo sem isto: é desfazer o rascunho.
   */
  podeApagar: boolean;
  /**
   * Torna esta coluna o alvo da semântica dela. Não há "desmarcar": sem alvo,
   * criar tarefa no quadro devolve 422.
   */
  onTornarAlvo: () => void;
  /** Desfaz um "tornar padrão" deste rascunho (ver `semAlvo`). */
  onDesfazerAlvo?: () => void;
  /**
   * Liga ou desliga a cobrança de prazo desta coluna. Recebe o valor novo, para
   * dois cliques rápidos não lerem o mesmo estado velho.
   */
  onAvisar: (valor: boolean) => void;
  onMover: (direcao: "esquerda" | "direita") => void;
  /** Vem do `useSortable`. Ausente nos testes. */
  arrasteRef?: (no: HTMLElement | null) => void;
  arrasteProps?: Record<string, unknown>;
}) {
  const [editandoNome, setEditandoNome] = useState(false);
  const [rascunhoNome, setRascunhoNome] = useState(linha.nome);
  const campoRef = useRef<HTMLInputElement | null>(null);

  // O foco vai para o campo ao abrir.
  useEffect(() => {
    if (!editandoNome) return;
    // `focus()` e depois `select()`: no jsdom `select()` sozinho não move o foco.
    campoRef.current?.focus();
    campoRef.current?.select();
  }, [editandoNome]);

  // Ressincroniza quando o nome muda por fora (ex.: ao descartar a edição).
  useEffect(() => {
    if (!editandoNome) setRascunhoNome(linha.nome);
  }, [linha.nome, editandoNome]);

  function confirmarNome() {
    const limpo = rascunhoNome.trim();
    setEditandoNome(false);
    // Nome vazio não vira renomeação: o 422 derrubaria o lote inteiro.
    if (limpo && limpo !== linha.nome) onRenomear(limpo);
    else setRascunhoNome(linha.nome);
  }

  return (
    <div
      // `flexWrap`: num cabeçalho de ~250px o que não cabe desce de linha.
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 6,
        rowGap: 4,
        marginBottom: 10,
        paddingBottom: 8,
        borderBottom: `2px solid ${cor}`,
        flexShrink: 0,
        // A coluna marcada para apagar fica esmaecida, mas legível: ainda dá para desmarcar.
        opacity: linha.apagada ? 0.45 : 1,
      }}
      data-apagada={linha.apagada ? "sim" : "nao"}
    >
      {/* A alça é o único ponto de arraste: clicar no nome renomeia. */}
      <span
        ref={arrasteRef}
        {...(arrasteProps ?? {})}
        aria-label={`Arrastar ${linha.nome}`}
        style={{
          display: "inline-flex",
          cursor: linha.apagada ? "default" : "grab",
          color: "var(--text-faint)",
          touchAction: "none",
        }}
      >
        <GripVertical size={14} />
      </span>

      <span
        style={{ width: 8, height: 8, borderRadius: 999, background: cor }}
      />

      {editandoNome ? (
        <input
          ref={campoRef}
          className="input"
          value={rascunhoNome}
          aria-label={`Nome da coluna ${linha.nome}`}
          // Mesmo teto do backend: um nome longo derrubaria o lote inteiro.
          // `maxLength` não trunca valor vindo do servidor, só barra digitação.
          maxLength={60}
          onChange={(e) => setRascunhoNome(e.target.value)}
          onBlur={confirmarNome}
          onKeyDown={(e) => {
            // `stopPropagation`: Esc fecharia o modo de edição e Enter concluiria.
            e.stopPropagation();
            if (e.key === "Enter") confirmarNome();
            if (e.key === "Escape") {
              setRascunhoNome(linha.nome);
              setEditandoNome(false);
            }
          }}
          style={{ fontSize: 13, padding: "2px 6px", height: 26, flex: 1 }}
        />
      ) : (
        <button
          type="button"
          onClick={() => !linha.apagada && setEditandoNome(true)}
          disabled={linha.apagada}
          title={linha.apagada ? undefined : "Clique para renomear"}
          style={{
            fontWeight: 700,
            fontSize: 13,
            background: "none",
            border: "none",
            padding: 0,
            cursor: linha.apagada ? "default" : "text",
            color: "inherit",
            textAlign: "left",
            textDecoration: linha.apagada ? "line-through" : "none",
            // O nome comprido corta com "…" em vez de empurrar o resto.
            flex: "1 1 auto",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {linha.nome}
        </button>
      )}

      {/* Coluna nova: ainda não existe no servidor e a cor vai mudar. */}
      {linha.nova && (
        <span
          className="muted"
          style={{ fontSize: 10, whiteSpace: "nowrap" }}
          title="Esta coluna ainda não existe. Ela é criada quando você concluir a edição."
        >
          nova
        </span>
      )}

      {/* Selo do alvo da cascata (`is_default_target`, não a primeira pela
          ordem). Na coluna que já é o alvo não é botão: não existe desmarcar. */}
      {linha.alvo && !linha.apagada && (
        <span
          className="muted"
          style={{ fontSize: 10, whiteSpace: "nowrap" }}
          title={`O sistema usa esta coluna quando precisa escolher sozinho uma coluna ${ROTULO_DA_SEMANTICA[linha.semantic] ?? ""}.`}
        >
          padrão
        </span>
      )}
      {/* O "×" desfaz só o padrão pedido neste rascunho, não o salvo. */}
      {linha.alvo && linha.alvoPedido && !linha.apagada && onDesfazerAlvo && (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onDesfazerAlvo}
          aria-label={`Desfazer: ${linha.nome} deixa de ser a coluna padrão`}
          title="Desfazer (volta para a coluna que já era a padrão)"
          style={{ padding: 0, height: 16, minWidth: 16, fontSize: 11, lineHeight: 1 }}
        >
          ×
        </button>
      )}

      {/* O convite "tornar padrão": nunca na coluna apagada nem na nova (sem
          id; `comAlvo` recusa `tmp:`). */}
      {!linha.alvo && !linha.apagada && !linha.nova && (
        <button
          type="button"
          onClick={onTornarAlvo}
          aria-label={`Tornar ${linha.nome} a coluna padrão de ${ROTULO_DA_SEMANTICA[linha.semantic] ?? "sua semântica"}`}
          title={`Fazer o sistema usar esta coluna quando precisar escolher sozinho uma coluna ${ROTULO_DA_SEMANTICA[linha.semantic] ?? ""}.`}
          style={{
            fontSize: 10, whiteSpace: "nowrap",
            background: "none", border: "1px dashed var(--border)",
            borderRadius: 999, padding: "0 6px", cursor: "pointer",
            color: "var(--text-faint)", lineHeight: "16px",
          }}
        >
          tornar padrão
        </button>
      )}

      {/* ---- Cobrar prazo ----
          Ícone por falta de espaço: o texto vai no `title`/`aria-label` e o
          estado no `aria-pressed`. Nunca em coluna terminal (o backend ignora
          a flag) nem na apagada. */}
      {!linha.apagada && !semanticaTerminal(linha.semantic) && (
        <button
          type="button"
          onClick={() => onAvisar(!linha.avisaPrazo)}
          aria-pressed={linha.avisaPrazo}
          aria-label={`Cobrar prazo na coluna ${linha.nome}`}
          title={
            linha.avisaPrazo
              ? "Cobra prazo: as tarefas daqui ficam vermelhas quando atrasam e geram aviso. Clique para desligar."
              : "Não cobra prazo: as tarefas daqui não ficam vermelhas por atraso nem geram aviso. Clique para ligar."
          }
          style={{
            display: "inline-flex", alignItems: "center",
            background: "none", border: "none", padding: 2,
            cursor: "pointer", lineHeight: 0,
            color: linha.avisaPrazo ? "var(--text-faint)" : "var(--text-soft)",
          }}
        >
          {linha.avisaPrazo ? <Bell size={13} /> : <BellOff size={13} />}
        </button>
      )}

      <span style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
        <button
          type="button"
          className="btn btn-ghost"
          aria-label={`Mover ${linha.nome} para a esquerda`}
          disabled={!podeIrEsquerda}
          onClick={() => onMover("esquerda")}
          style={{ padding: 2, height: 22 }}
        >
          <ChevronLeft size={14} />
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          aria-label={`Mover ${linha.nome} para a direita`}
          disabled={!podeIrDireita}
          onClick={() => onMover("direita")}
          style={{ padding: 2, height: 22 }}
        >
          <ChevronRight size={14} />
        </button>

        {/* Com impedimento, o botão dá lugar ao motivo. Sem permissão de
            apagar, nenhum dos dois, salvo na coluna nova (desfazer o rascunho). */}
        {(podeApagar || linha.nova) && (linha.impedimento ? (
          // Cadeado em vez do texto, que não cabe; o motivo vai na dica e no leitor de tela.
          <span
            className="muted"
            style={{ display: "inline-flex", padding: 2, lineHeight: 0 }}
            title={linha.impedimento}
          >
            <Lock size={13} aria-hidden="true" />
            <span className="sr-only">não pode ser apagada</span>
          </span>
        ) : (
          <button
            type="button"
            className="btn btn-ghost"
            aria-label={
              linha.apagada
                ? `Manter ${linha.nome}`
                : `Apagar ${linha.nome}`
            }
            onClick={onMarcar}
            style={{
              padding: 2,
              height: 22,
              color: linha.apagada ? "var(--text-soft)" : "var(--danger)",
            }}
          >
            {linha.apagada ? (
              <span style={{ fontSize: 11, padding: "0 4px" }}>desfazer</span>
            ) : (
              <X size={14} />
            )}
          </button>
        ))}
      </span>
    </div>
  );
}
