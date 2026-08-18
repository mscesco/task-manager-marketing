"use client";

import { useEffect, useRef, useState } from "react";

import { nomeConfere } from "@/lib/seletorDeQuadro";
import { plural } from "@/lib/plural";

/**
 * A confirmação de APAGAR QUADRO (Spec 036, fatia 7).
 *
 * ⚠️⚠️ **É A OPERAÇÃO MAIS DESTRUTIVA DO PRODUTO, E A ÚNICA QUE NÃO PERGUNTA O
 * DESTINO DAS TAREFAS.** Apagar coluna sempre oferece para onde elas vão, e a
 * revisão mostra a contagem — a pessoa aprendeu que apagar não perde tarefa.
 * Aqui elas somem junto. Este diálogo existe porque a expectativa que o resto
 * do produto ensinou está ERRADA neste botão.
 *
 * ⚠️ POR ISSO A CONFIRMAÇÃO É POR DIGITAÇÃO, e não um "tem certeza?". O
 * segundo é um clique a mais; o primeiro obriga a LER o nome do quadro. E é o
 * único momento em que dá para reparar que o quadro aberto não é o que se
 * pensava.
 *
 * ⚠️ E ELA SÓ FUNCIONA PORQUE O NOME É ÚNICO NO TIME (fatia 9). Com três
 * quadros "Quadro CRM Teste", digitar o nome não diz qual — a confirmação
 * viraria teatro. Foi por isso que aquela fatia veio antes desta.
 *
 * ⚠️ NÃO HÁ DESFAZER. O resgate é `backend/scripts/restaurar_quadro.sql`,
 * rodado no banco por quem tem acesso a ele. O texto diz isso, porque quem
 * está prestes a clicar precisa saber que não existe botão de voltar.
 */
export default function ConfirmarExclusaoDeQuadro({
  nome,
  contagem,
  erro,
  ocupado,
  onConfirmar,
  onCancelar,
}: {
  nome: string;
  /** `null` = ainda contando. ⚠️ Trava o botão: ver abaixo. */
  contagem: number | null;
  erro: string | null;
  ocupado: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  const [digitado, setDigitado] = useState("");
  const campoRef = useRef<HTMLInputElement | null>(null);
  const caixaRef = useRef<HTMLDivElement | null>(null);

  // ⚠️ O FOCO VAI PARA O CAMPO, e não para a caixa. Aqui a única coisa a fazer
  // é digitar; quem usa teclado não pode precisar de um Tab para começar.
  useEffect(() => {
    campoRef.current?.focus();
  }, []);

  const confere = nomeConfere(digitado, nome);
  // ⚠️ A CONTAGEM TRAVA O BOTÃO ENQUANTO NÃO CHEGA. Confirmar sem saber quantas
  // tarefas vão junto é exatamente o que este diálogo existe para impedir --
  // e um `?? 0` aqui faria a tela dizer "nenhuma tarefa" sobre um quadro cheio.
  const podeConfirmar = confere && contagem !== null && !ocupado;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(16,24,40,0.45)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "8vh 16px 24px",
      }}
    >
      <div
        ref={caixaRef}
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={`Apagar o quadro ${nome}`}
        onKeyDown={(e) => {
          // ⚠️ `Esc` FECHA, e `Enter` NÃO confirma. Em todo o resto do produto
          // Enter confirma; aqui ele é a tecla que a pessoa aperta por reflexo
          // depois de digitar, e o custo do reflexo seria apagar as tarefas.
          if (e.key === "Escape" && !ocupado) {
            e.stopPropagation();
            onCancelar();
          }
        }}
        style={{
          width: 480,
          maxWidth: "100%",
          maxHeight: "84vh",
          overflowY: "auto",
          background: "var(--surface)",
          borderRadius: 12,
          padding: 20,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 15 }}>
          Apagar o quadro &quot;{nome}&quot;?
        </div>

        {/* ⚠️ A CONTAGEM VEM ANTES DA CAIXA DE TEXTO, e não depois. É o número
            que muda a decisão; embaixo do campo, ela seria lida depois de a
            pessoa já ter digitado. */}
        <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>
          {contagem === null ? (
            "Contando as tarefas…"
          ) : contagem === 0 ? (
            "Este quadro não tem nenhuma tarefa."
          ) : (
            <>
              As <strong>{contagem}</strong>{" "}
              {plural(contagem, "tarefa", "tarefas")} deste quadro{" "}
              <strong>
                {plural(contagem, "vai ser apagada", "vão ser apagadas")} junto
              </strong>
              , inclusive as arquivadas.
            </>
          )}
        </div>

        <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
          Não há como desfazer pela tela. Recuperar depois exige acesso ao banco
          de dados.
        </div>

        <label
          htmlFor="confirmar-nome-do-quadro"
          style={{ display: "block", fontSize: 13, marginTop: 16 }}
        >
          Digite <strong>{nome}</strong> para confirmar:
        </label>
        <input
          id="confirmar-nome-do-quadro"
          ref={campoRef}
          className="input"
          value={digitado}
          autoComplete="off"
          onChange={(e) => setDigitado(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          style={{ width: "100%", marginTop: 6 }}
        />

        {erro && (
          <div
            role="alert"
            className="error-text"
            style={{ fontSize: 13, marginTop: 12 }}
          >
            {erro}
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
            marginTop: 18,
          }}
        >
          <button className="btn btn-ghost" onClick={onCancelar} disabled={ocupado}>
            Cancelar
          </button>
          {/* ⚠️ VERMELHO SEMPRE. Não há caso em que este botão seja a ação
              segura -- diferente da revisão de colunas, onde o vermelho só
              aparece quando há exclusão. */}
          <button
            className="btn btn-danger"
            onClick={onConfirmar}
            disabled={!podeConfirmar}
          >
            {ocupado ? "Apagando…" : "Apagar quadro"}
          </button>
        </div>
      </div>
    </div>
  );
}
