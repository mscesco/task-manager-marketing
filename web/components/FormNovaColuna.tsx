"use client";

import CaixaDeDialogo from "@/components/CaixaDeDialogo";
import { useEffect, useRef, useState } from "react";

import type { ColumnSemantic } from "@/lib/coluna";
import { ROTULO_DA_SEMANTICA } from "@/lib/edicaoDeColunas";
import { CORES_DE_COLUNA, semanticaTerminal } from "@/lib/coluna";

const TIPOS: ColumnSemantic[] = ["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"];

/**
 * Teto do nome de coluna. 60, não os 120 do banco: protege o cabeçalho de
 * atropelar a vizinha. Espelha `BoardService.NOME_DE_COLUNA_MAX`.
 */
const MAX_NOME = 60;

/**
 * A sobreposição de criar coluna. A coluna entra no rascunho e só existe no
 * servidor ao concluir a edição.
 */
export default function FormNovaColuna({
  onCriar,
  onCancelar,
}: {
  onCriar: (
    nome: string,
    semantica: ColumnSemantic,
    /** `undefined` = não escolheu; a rotação do backend decide. */
    cor: string | undefined,
    avisaPrazo: boolean,
  ) => void;
  onCancelar: () => void;
}) {
  const [nome, setNome] = useState("");
  const [semantica, setSemantica] = useState<ColumnSemantic>("IN_PROGRESS");
  // `undefined` é legítimo: "deixa a rotação escolher". Abre sem tento marcado.
  const [cor, setCor] = useState<string | undefined>(undefined);
  const [avisaPrazo, setAvisaPrazo] = useState(true);
  const caixaRef = useRef<HTMLDivElement | null>(null);
  const nomeRef = useRef<HTMLInputElement | null>(null);

  // Foco no primeiro campo.
  useEffect(() => {
    nomeRef.current?.focus();
  }, []);

  const limpo = nome.trim();
  const podeCriar = limpo.length > 0 && limpo.length <= MAX_NOME;

  return (
    // Só o clique no próprio fundo fecha (ver `CaixaDeDialogo`).
    <CaixaDeDialogo
      ariaLabel="Criar coluna"
      largura={380}
      caixaRef={caixaRef}
      onEsc={onCancelar}
      onFundo={onCancelar}
      respiroNoTopo="12vh"
      acimaDeModal={false}
      isolarCliques
    >
        <div className="field">
          <label className="label" htmlFor="nova-coluna-nome">
            Nome da coluna
          </label>
          <input
            id="nova-coluna-nome"
            ref={nomeRef}
            className="input"
            value={nome}
            maxLength={MAX_NOME}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => {
              // Enter só cria quando dá para criar; num campo vazio pareceria criado.
              if (e.key === "Enter" && podeCriar) {
                e.preventDefault();
                onCriar(limpo, semantica, cor, avisaPrazo);
              }
            }}
          />
        </div>

        <div className="field" style={{ marginTop: 14 }}>
          <label className="label" htmlFor="nova-coluna-tipo">
            Tipo
          </label>
          <select
            id="nova-coluna-tipo"
            className="input"
            value={semantica}
            onChange={(e) => setSemantica(e.target.value as ColumnSemantic)}
          >
            {TIPOS.map((t) => (
              <option key={t} value={t}>
                {ROTULO_DA_SEMANTICA[t]}
              </option>
            ))}
          </select>
          {/* Criar é seguro porque a coluna nasce vazia; editar o tipo mudaria
              tarefas existentes em silêncio. */}
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            O tipo não muda depois. Ele decide o que acontece com as tarefas que
            entram aqui.
          </div>
        </div>

        {/* ---- Cor ----
            Oito tokens, não hex: token inverte no tema escuro. "Automática"
            manda `undefined` e deixa a rotação do backend decidir. */}
        <div className="field" style={{ marginTop: 14 }}>
          <span className="label" id="nova-coluna-cor">
            Cor
          </span>
          <div
            role="radiogroup"
            aria-labelledby="nova-coluna-cor"
            style={{
              display: "flex", flexWrap: "wrap", alignItems: "center",
              gap: 8, marginTop: 4,
            }}
          >
            <button
              type="button"
              role="radio"
              aria-checked={cor === undefined}
              onClick={() => setCor(undefined)}
              title="Deixar o sistema escolher"
              style={{
                height: 28, padding: "0 10px", borderRadius: 999,
                fontSize: 12, fontWeight: cor === undefined ? 600 : 400,
                cursor: "pointer",
                border:
                  cor === undefined
                    ? "1px solid var(--accent)"
                    : "1px dashed var(--border)",
                background:
                  cor === undefined ? "var(--accent-soft)" : "transparent",
                color: cor === undefined ? "var(--accent)" : "var(--text-soft)",
              }}
            >
              Automática
            </button>
            {CORES_DE_COLUNA.map((token, i) => (
              <button
                key={token}
                type="button"
                role="radio"
                aria-checked={cor === token}
                onClick={() => setCor(token)}
                // O rótulo acessível é o número: o nome do token não descreve a cor.
                aria-label={`Cor ${i + 1}`}
                title={`Cor ${i + 1}`}
                style={{
                  width: 28, height: 28, borderRadius: 999, cursor: "pointer",
                  background: token,
                  // Anel com box-shadow, não border, para a cor não encolher.
                  border: "1px solid var(--border)",
                  boxShadow:
                    cor === token
                      ? "0 0 0 2px var(--surface), 0 0 0 4px var(--accent)"
                      : undefined,
                }}
              />
            ))}
          </div>
        </div>

        {/* ---- Cobrar prazo ----
            Rótulo por extenso com as consequências: desmarcar silencia
            notificação. Some em coluna terminal, onde o backend ignora a flag. */}
        {!semanticaTerminal(semantica) && (
          <div className="field" style={{ marginTop: 14 }}>
            <label
              style={{
                display: "flex", alignItems: "flex-start", gap: 8,
                cursor: "pointer", fontSize: 13,
              }}
            >
              <input
                type="checkbox"
                checked={avisaPrazo}
                onChange={(e) => setAvisaPrazo(e.target.checked)}
                style={{ marginTop: 2, cursor: "pointer", flexShrink: 0 }}
              />
              <span>
                Cobrar prazo nesta coluna
                <span
                  className="muted"
                  style={{ display: "block", fontSize: 12, marginTop: 2 }}
                >
                  Desmarcado, as tarefas daqui não ficam vermelhas por atraso e
                  não geram aviso de prazo. Serve para etapas de espera, como
                  “Aguardando cliente”.
                </span>
              </span>
            </label>
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 20,
          }}
        >
          <button type="button" className="btn btn-ghost" onClick={onCancelar}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!podeCriar}
            onClick={() => onCriar(limpo, semantica, cor, avisaPrazo)}
          >
            Criar
          </button>
        </div>
    </CaixaDeDialogo>
  );
}
