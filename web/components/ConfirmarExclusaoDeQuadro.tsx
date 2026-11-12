"use client";

import CaixaDeDialogo from "@/components/CaixaDeDialogo";
import { useEffect, useRef, useState } from "react";

import { nomeConfere } from "@/lib/seletorDeQuadro";
import { plural } from "@/lib/plural";

/**
 * A confirmação de apagar quadro: as tarefas somem junto, sem pergunta de
 * destino e sem desfazer (o resgate é `backend/scripts/restaurar_quadro.sql`).
 * Confirma por digitação do nome, que é único no time.
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
  /** `null` = ainda contando; trava o botão. */
  contagem: number | null;
  erro: string | null;
  ocupado: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  const [digitado, setDigitado] = useState("");
  const campoRef = useRef<HTMLInputElement | null>(null);
  const caixaRef = useRef<HTMLDivElement | null>(null);

  // O foco vai para o campo: a única coisa a fazer é digitar.
  useEffect(() => {
    campoRef.current?.focus();
  }, []);

  const confere = nomeConfere(digitado, nome);
  // Sem a contagem o botão fica travado; um `?? 0` diria "nenhuma tarefa".
  const podeConfirmar = confere && contagem !== null && !ocupado;

  return (
    // Esc fecha e Enter não confirma: o Enter de reflexo apagaria as tarefas.
    // Sem `onFundo`: em diálogo destrutivo, clicar ao lado não fecha.
    <CaixaDeDialogo
      ariaLabel={`Apagar o quadro ${nome}`}
      largura={480}
      caixaRef={caixaRef}
      onEsc={ocupado ? undefined : onCancelar}
    >
        <div style={{ fontWeight: 700, fontSize: 15 }}>
          Apagar o quadro &quot;{nome}&quot;?
        </div>

        {/* A contagem vem antes do campo, para ser lida antes de digitar. */}
        <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>
          {contagem === null ? (
            "Contando as tarefas…"
          ) : contagem === 0 ? (
            "Este quadro não tem nenhuma tarefa."
          ) : (
            <>
              {/* `plural` já põe o número na frente. */}
              {contagem === 1 ? "A" : "As"}{" "}
              <strong>{plural(contagem, "tarefa", "tarefas")}</strong> deste
              quadro{" "}
              <strong>
                {contagem === 1 ? "vai ser apagada" : "vão ser apagadas"} junto
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
          {/* Sempre vermelho: nunca é a ação segura. */}
          <button
            className="btn btn-danger"
            onClick={onConfirmar}
            disabled={!podeConfirmar}
          >
            {ocupado ? "Apagando…" : "Apagar quadro"}
          </button>
        </div>
    </CaixaDeDialogo>
  );
}
