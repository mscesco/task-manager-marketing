"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, GripVertical, X } from "lucide-react";

import type { LinhaDeEdicao } from "@/lib/rascunhoDeColunas";
import { ROTULO_DA_SEMANTICA } from "@/lib/edicaoDeColunas";

/**
 * O cabeçalho de uma coluna com o modo de edição LIGADO (Spec 036, fatia 6c-2).
 *
 * ⚠️ MESMA ANATOMIA DO CABEÇALHO NORMAL -- ponto colorido, nome, borda inferior
 * na cor da coluna --, com os controles no lugar da contagem. Desenhar outra
 * coisa faria o modo de edição parecer outra tela, e a pessoa perderia a
 * referência de qual coluna é qual justamente quando está movendo colunas.
 *
 * ⚠️ NADA AQUI FALA COM O SERVIDOR. O modo é de LOTE: tudo o que acontece nesta
 * tela vive no rascunho até a pessoa concluir. Este componente só reporta
 * intenções para cima.
 */
export default function CabecalhoDeColunaEditavel({
  linha,
  cor,
  podeIrEsquerda,
  podeIrDireita,
  onRenomear,
  onMarcar,
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
  onMover: (direcao: "esquerda" | "direita") => void;
  /** Vem do `useSortable`. Ausente nos testes -- ver o comentário da alça. */
  arrasteRef?: (no: HTMLElement | null) => void;
  arrasteProps?: Record<string, unknown>;
}) {
  const [editandoNome, setEditandoNome] = useState(false);
  const [rascunhoNome, setRascunhoNome] = useState(linha.nome);
  const campoRef = useRef<HTMLInputElement | null>(null);

  // ⚠️ O FOCO VAI PARA O CAMPO AO ABRIR. Sem isto a pessoa clica no nome, o
  // campo aparece, e ela precisa clicar de novo -- e quem usa leitor de tela
  // não é avisado de que o modo de digitação começou.
  useEffect(() => {
    if (!editandoNome) return;
    // ⚠️ `focus()` E DEPOIS `select()`, e nao so o segundo. Medido em 13/08:
    // `select()` sozinho seleciona o texto mas NAO move o foco no jsdom -- e o
    // teste do foco caiu apontando para o `<body>`. Em navegador ele costuma
    // focar de tabela, o que faria o defeito passar despercebido ate alguem
    // usar teclado.
    campoRef.current?.focus();
    campoRef.current?.select();
  }, [editandoNome]);

  // ⚠️ RESSINCRONIZA QUANDO O NOME MUDA POR FORA. Acontece ao descartar a
  // edição: o rascunho volta ao original e este campo ficaria com o texto
  // velho, mentindo sobre o estado.
  useEffect(() => {
    if (!editandoNome) setRascunhoNome(linha.nome);
  }, [linha.nome, editandoNome]);

  function confirmarNome() {
    const limpo = rascunhoNome.trim();
    setEditandoNome(false);
    // ⚠️ NOME VAZIO NÃO VIRA RENOMEAÇÃO. O backend recusaria com 422, e no lote
    // isso derruba a edição inteira -- por um campo que a pessoa só limpou sem
    // querer antes de desistir.
    if (limpo && limpo !== linha.nome) onRenomear(limpo);
    else setRascunhoNome(linha.nome);
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginBottom: 10,
        paddingBottom: 8,
        borderBottom: `2px solid ${cor}`,
        flexShrink: 0,
        // ⚠️ A COLUNA MARCADA FICA APAGADA, MAS LEGÍVEL. Ela continua na tela
        // porque o modelo é de lote: enquanto não concluir, nada aconteceu, e a
        // pessoa precisa poder desmarcar.
        opacity: linha.apagada ? 0.45 : 1,
      }}
      data-apagada={linha.apagada ? "sim" : "nao"}
    >
      {/* ⚠️ A ALÇA É O ÚNICO PONTO DE ARRASTE, e não o cabeçalho inteiro:
          clicar no nome renomeia, e as duas coisas no mesmo alvo fariam um
          clique curto virar arraste de 2px e vice-versa. */}
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
          onChange={(e) => setRascunhoNome(e.target.value)}
          onBlur={confirmarNome}
          onKeyDown={(e) => {
            // ⚠️ `stopPropagation` NOS DOIS: `Esc` fecharia o modo de edição
            // inteiro e `Enter` poderia disparar o botão de concluir. Aqui as
            // duas teclas pertencem ao campo.
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
          }}
        >
          {linha.nome}
        </button>
      )}

      {/* ⚠️ O SELO DE ALVO EXISTE PORQUE REORDENAR TORNA A CONFUSÃO PROVÁVEL.
          O destino da cascata é `is_default_target` e NÃO a primeira pela ordem
          (ADR 0030). Sem o selo, alguém põe "Entregue" antes de "Concluído" e
          espera que as tarefas passem a cair lá -- e não vão, sem nada avisar. */}
      {linha.alvo && !linha.apagada && (
        <span
          className="muted"
          style={{ fontSize: 10, whiteSpace: "nowrap" }}
          title={`O sistema usa esta coluna quando precisa escolher sozinho uma coluna ${ROTULO_DA_SEMANTICA[linha.semantic] ?? ""}.`}
        >
          padrão
        </span>
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

        {/* ⚠️ COM IMPEDIMENTO, O BOTÃO NÃO EXISTE -- e o motivo aparece no
            lugar. Desabilitado seria pior: a pessoa clica, nada acontece, e ela
            não sabe se o produto travou ou se ela não pode. */}
        {linha.impedimento ? (
          <span
            className="muted"
            style={{ fontSize: 10, maxWidth: 120, lineHeight: 1.2 }}
            title={linha.impedimento}
          >
            não pode ser apagada
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
        )}
      </span>
    </div>
  );
}
