"use client";
import { useEffect, useRef, useState } from "react";

import { ApiError, createBoard, renameBoard, type Quadro } from "@/lib/api";
import {
  nomeDeQuadroValido,
  opcaoSelecionada,
  opcoesDoSeletor,
  type OpcaoDeQuadro,
} from "@/lib/seletorDeQuadro";

/**
 * Spec 036, fatia 5b-6 -- o seletor de quadro da tela do time.
 *
 * ⚠️ ESTE COMPONENTE NAO DECIDE NADA. Quem lista, ordena, filtra e diz o que
 * tem afordancia e `lib/seletorDeQuadro.ts`, que e puro e testado isolado.
 * Aqui so ha desenho e o vaivem com a API. E a fronteira da Spec 027, e o
 * motivo dela esta escrito no `permissoesMembros.ts`: foi espalhar maquina de
 * estado dentro de componente grande que causou o bug do modal.
 *
 * ⚠️ CRIAR E RENOMEAR MORAM AQUI, E NAO NO MENU LATERAL (ADR 0034 item 5). O
 * quadro pertence a um time; oferecer "novo quadro" num menu global obrigaria
 * a perguntar de qual time depois, e e exatamente a pergunta que a tela do
 * time ja respondeu.
 *
 * ⚠️ A LENTE NAO MOSTRA RENOMEAR -- AUSENTE, E NAO DESABILITADA (ADR 0034
 * item 2). `opcao.podeRenomear` ja vem `false` para ela sempre, inclusive para
 * ADMIN: nao ha registro para renomear. Botao desabilitado e botao em que
 * alguem clica, e depois pergunta por que nada aconteceu.
 */
export default function SeletorDeQuadro({
  teamId,
  quadros,
  selecionado,
  podeGerir,
  onSelecionar,
  onMudou,
}: {
  teamId: string;
  quadros: readonly Quadro[];
  /** `null` = a lente. Ver `OpcaoDeQuadro.id`. */
  selecionado: string | null;
  podeGerir: boolean;
  onSelecionar: (id: string | null) => void;
  /**
   * Chamado depois de criar ou renomear, para a tela recarregar a lista.
   *
   * ⚠️ O PAI RECARREGA, e este componente NAO guarda a lista. `listBoards` nao
   * e memoizada de proposito (ver `lib/__tests__/quadros.test.ts`), e duas
   * copias da lista divergiriam no primeiro erro de rede.
   */
  onMudou: (quadroNovo?: Quadro) => void;
}) {
  const opcoes = opcoesDoSeletor(quadros, teamId, podeGerir);
  const atual = opcaoSelecionada(opcoes, selecionado);

  // `null` = nenhum formulario aberto; `"novo"` = criando; um id = renomeando.
  const [editando, setEditando] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const campoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editando) campoRef.current?.focus();
  }, [editando]);

  function abrirNovo() {
    setEditando("novo");
    setNome("");
    setErro(null);
  }

  function abrirRenomear(opcao: OpcaoDeQuadro) {
    if (opcao.id === null) return; // a lente nao se renomeia
    setEditando(opcao.id);
    setNome(opcao.nome);
    setErro(null);
  }

  function fechar() {
    setEditando(null);
    setNome("");
    setErro(null);
  }

  async function salvar() {
    // ⚠️ VALIDA ANTES DE MANDAR. A regra e a mesma do backend
    // (`BoardService._nome_valido`), e a duplicacao existe para nao gastar uma
    // requisicao que ja se sabe que volta 422 -- erro depois de digitar, para
    // uma regra que a tela ja conhecia.
    const limpo = nomeDeQuadroValido(nome);
    if (limpo === null) {
      setErro("O nome não pode ficar vazio e tem no máximo 255 caracteres.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      if (editando === "novo") {
        const quadro = await createBoard({ name: limpo, team_id: teamId });
        fechar();
        // ⚠️ SELECIONA O QUE ACABOU DE NASCER. Criar e continuar na lente
        // deixaria a pessoa sem sinal de que algo aconteceu -- o quadro novo
        // ficaria escondido atras de mais um clique.
        onSelecionar(quadro.id);
        onMudou(quadro);
      } else if (editando) {
        await renameBoard(editando, limpo);
        fechar();
        onMudou();
      }
    } catch (e) {
      // ⚠️ A MENSAGEM DO BACKEND VEM PRIMEIRO. Ela e quem sabe distinguir
      // "sem permissao neste time" de "nome duplicado" -- trocar por um texto
      // fixo aqui esconderia a causa de quem esta olhando a tela.
      setErro(
        (e as ApiError).message || "Não consegui salvar. Tente de novo."
      );
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        role="tablist"
        aria-label="Quadros deste time"
        style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
      >
        {opcoes.map((o) => {
          const ativa = o.id === atual.id;
          return (
            <span key={o.id ?? "lente"} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <button
                role="tab"
                aria-selected={ativa}
                onClick={() => onSelecionar(o.id)}
                title={o.descricao}
                className={ativa ? "btn btn-primary" : "btn btn-ghost"}
                style={{ fontSize: 13 }}
              >
                {o.nome}
                {o.descricao && (
                  <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>
                    {o.descricao}
                  </span>
                )}
              </button>
              {/* ⚠️ AUSENTE, e nao desabilitado, quando nao pode. */}
              {o.podeRenomear && (
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12 }}
                  onClick={() => abrirRenomear(o)}
                  aria-label={`Renomear ${o.nome}`}
                >
                  Renomear
                </button>
              )}
            </span>
          );
        })}

        {podeGerir && editando === null && (
          <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={abrirNovo}>
            + Novo quadro
          </button>
        )}
      </div>

      {editando !== null && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            ref={campoRef}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") salvar();
              if (e.key === "Escape") fechar();
            }}
            placeholder="Nome do quadro"
            aria-label={editando === "novo" ? "Nome do novo quadro" : "Novo nome do quadro"}
            style={{ minWidth: 220 }}
          />
          <button className="btn btn-primary" onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando…" : editando === "novo" ? "Criar" : "Salvar"}
          </button>
          <button className="btn btn-ghost" onClick={fechar} disabled={salvando}>
            Cancelar
          </button>
          {erro && (
            <span role="alert" className="error-text" style={{ fontSize: 12 }}>
              {erro}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
