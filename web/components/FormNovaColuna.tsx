"use client";

import { useEffect, useRef, useState } from "react";

import type { ColumnSemantic } from "@/lib/coluna";
import { ROTULO_DA_SEMANTICA } from "@/lib/edicaoDeColunas";

const TIPOS: ColumnSemantic[] = ["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"];

/**
 * Teto do nome de coluna.
 *
 * ⚠️ 60, E NAO OS 120 DO BANCO (18/08). O `String(120)` de `board_column.name`
 * protege o Postgres; este numero protege o cabecalho de atropelar a coluna
 * vizinha. Espelha `BoardService.NOME_DE_COLUNA_MAX` -- se mudar la, mude aqui.
 * Ate 18/08 este valor era 120 e o comentario dizia "teto do backend", o que
 * fazia parecer que os dois numeros TINHAM de ser o mesmo. Nao tem.
 */
const MAX_NOME = 60;

/**
 * A sobreposição de criar coluna (Spec 036, fatia 6c-2).
 *
 * ⚠️ SEM CAMPO DE COR, e isso é decisão de 13/08. Hoje a cor sai de
 * `_cor_por_rotacao` sobre os 8 tokens do tema, com contraste já conferido;
 * aceitar cor livre exige schema novo, validação e a decisão paleta × hex --
 * e o `plan.md` registra que "cor livre e contraste AA" não é validado. Virou
 * fatia própria.
 *
 * ⚠️ A COLUNA NÃO NASCE AQUI. Ela entra no RASCUNHO e só existe no servidor
 * quando a pessoa concluir a edição. É o que permite apagar outra coluna
 * mandando as tarefas para esta -- que é a razão de ser do lote.
 */
export default function FormNovaColuna({
  onCriar,
  onCancelar,
}: {
  onCriar: (nome: string, semantica: ColumnSemantic) => void;
  onCancelar: () => void;
}) {
  const [nome, setNome] = useState("");
  const [semantica, setSemantica] = useState<ColumnSemantic>("IN_PROGRESS");
  const caixaRef = useRef<HTMLDivElement | null>(null);
  const nomeRef = useRef<HTMLInputElement | null>(null);

  // ⚠️ FOCO NO PRIMEIRO CAMPO, e não na caixa. `role="dialog"` num bloco que só
  // aparece na árvore não anuncia nada sozinho, e aqui há um campo óbvio para
  // começar -- levar o foco a ele diz o que fazer sem texto nenhum.
  useEffect(() => {
    nomeRef.current?.focus();
  }, []);

  const limpo = nome.trim();
  const podeCriar = limpo.length > 0 && limpo.length <= MAX_NOME;

  return (
    <div
      className="modal-scrim"
      // ⚠️ O POSICIONAMENTO E INLINE, e nao vem da classe. `.modal-scrim` e
      // `.modal-card` no `globals.css` carregam SO a animacao de entrada --
      // conferido em 13/08. Confiar nelas para posicionar deixaria a caixa no
      // fluxo da pagina, empurrando o quadro para baixo em vez de flutuar.
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(16,24,40,0.45)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "12vh 16px 24px",
      }}
      onMouseDown={(e) => {
        // ⚠️ SÓ O CLIQUE NO PRÓPRIO FUNDO FECHA. Sem esta conferência, soltar o
        // botão fora depois de selecionar texto dentro do formulário fecharia
        // a caixa e jogaria fora o que a pessoa digitou.
        if (e.target === e.currentTarget) onCancelar();
      }}
    >
      <div
        ref={caixaRef}
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="Criar coluna"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancelar();
          }
        }}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 380,
          maxWidth: "100%",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: 20,
          boxShadow: "var(--shadow)",
        }}
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
              // ⚠️ ENTER CRIA, mas só quando dá para criar. Sem a condição, o
              // Enter num campo vazio fecharia o formulário sem fazer nada e
              // pareceria que a coluna foi criada.
              if (e.key === "Enter" && podeCriar) {
                e.preventDefault();
                onCriar(limpo, semantica);
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
          {/* ⚠️ "NÃO MUDA DEPOIS" E NÃO "IMUTÁVEL". No formulário de criação
              nada é imutável ainda -- a frase só faz sentido olhando para o
              futuro. E o MOTIVO importa: criar é seguro porque a coluna nasce
              vazia; editar mudaria o significado de tarefas existentes em
              silêncio. */}
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            O tipo não muda depois. Ele decide o que acontece com as tarefas que
            entram aqui.
          </div>
        </div>

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
            onClick={() => onCriar(limpo, semantica)}
          >
            Criar
          </button>
        </div>
      </div>
    </div>
  );
}
