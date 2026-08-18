"use client";
import { useEffect, useRef, useState } from "react";

import {
  ApiError,
  createBoard,
  deleteBoard,
  getBoard,
  renameBoard,
  type Quadro,
} from "@/lib/api";
import ConfirmarExclusaoDeQuadro from "@/components/ConfirmarExclusaoDeQuadro";
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

  // ---- apagar quadro (fatia 7) ----
  //
  // ⚠️ ESTADO SEPARADO DO DE RENOMEAR, e nao um `editando === "apagando"`. As
  // duas operacoes tem confirmacoes de peso oposto: renomear salva no Enter;
  // apagar exige digitar o nome e nem aceita Enter. Compartilhar a maquina de
  // estado faria um caminho herdar as teclas do outro.
  const [apagando, setApagando] = useState<OpcaoDeQuadro | null>(null);
  const [contagem, setContagem] = useState<number | null>(null);
  const [erroApagar, setErroApagar] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  // ⚠️ ESTADO PROPRIO, E NAO O `erro`. O `erro` so e desenhado DENTRO do
  // formulario de renomear -- pendurar o aviso de divergencia nele fazia a
  // mensagem ser escrita e nunca aparecer, porque o formulario esta fechado
  // quando alguem apaga. Pego pelo teste, nao pela leitura.
  const [divergencia, setDivergencia] = useState<string | null>(null);

  async function abrirApagar(opcao: OpcaoDeQuadro) {
    if (opcao.id === null) return;
    setApagando(opcao);
    setContagem(null);
    setErroApagar(null);
    setDivergencia(null);
    try {
      // ⚠️ A CONTAGEM E BUSCADA AO ABRIR, e nao guardada da listagem: o
      // `GET /boards` nao a traz. Enquanto ela nao chega, o botao de confirmar
      // fica travado -- confirmar sem saber quantas tarefas vao junto e o que
      // este dialogo existe para impedir.
      const detalhe = await getBoard(opcao.id);
      setContagem(detalhe.task_count);
    } catch (e) {
      setErroApagar(
        (e as ApiError).message ||
          "Não consegui contar as tarefas deste quadro."
      );
    }
  }

  async function confirmarExclusao() {
    if (!apagando?.id) return;
    setExcluindo(true);
    setErroApagar(null);
    try {
      const { tarefas_apagadas } = await deleteBoard(apagando.id);
      const eraOSelecionado = selecionado === apagando.id;
      setApagando(null);
      setContagem(null);
      // ⚠️ SAI DO QUADRO APAGADO ANTES DE RECARREGAR, e so se era ele que
      // estava aberto. Sem isto a tela ficaria pedindo um `boardId` que a
      // lista nao devolve mais -- que e o "Carregando…" eterno anotado no
      // `Board.tsx`.
      if (eraOSelecionado) onSelecionar(null);
      onMudou();
      // ⚠️ A DIVERGENCIA E AVISADA, e nao engolida. A contagem foi lida ao
      // abrir o dialogo; se alguem criou tarefa ali no meio, os dois numeros
      // discordam -- mesmo desenho da `mensagemDeDivergencia` do lote.
      if (contagem !== null && contagem !== tarefas_apagadas) {
        setDivergencia(
          `O aviso falava em ${contagem}, mas ${tarefas_apagadas} ` +
            `${tarefas_apagadas === 1 ? "tarefa foi apagada" : "tarefas foram apagadas"}. ` +
            `Alguém mexeu no quadro enquanto você confirmava.`
        );
      }
    } catch (e) {
      setErroApagar(
        (e as ApiError).message || "Não consegui apagar. Tente de novo."
      );
    } finally {
      setExcluindo(false);
    }
  }

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
        /* ⚠️ `group`, E NAO `tablist`. `tablist`/`tab` e um CONTRATO: quem
           usa leitor de tela ouve "aba 1 de 3" e espera navegar com as setas,
           com o Tab pulando o grupo inteiro e um `tabpanel` do outro lado do
           `aria-controls`. Nada disso existe aqui -- sao botoes comuns. Papel
           errado e pior que papel nenhum: sem ele a pessoa usa como botao;
           com ele, ela tenta o modelo anunciado e ele nao responde.
           `aria-pressed` nos botoes diz o que importa: qual esta escolhido. */
        role="group"
        aria-label="Quadros deste time"
        style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
      >
        {opcoes.map((o) => {
          const ativa = o.id === atual.id;
          return (
            <span key={o.id ?? "lente"} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <button
                type="button"
                aria-pressed={ativa}
                onClick={() => onSelecionar(o.id)}
                title={o.descricao}
                className={ativa ? "btn btn-primary" : "btn btn-ghost"}
                style={{ fontSize: 13 }}
              >
                {o.nome}
                {/* ⚠️ NA ABA ESCOLHIDA A DESCRICAO NAO PODE SER `muted`.
                    Medido: cinza `--text-faint` sobre o azul do `btn-primary`
                    da 1.68 no tema claro e 1.32 no escuro -- AA pede 4.5. Nao
                    era "dificil de ler", era invisivel. E logo AQUI: esta
                    frase e o que explica a diferenca entre a lente do time e
                    um quadro proprio, e ela sumia exatamente quando a pessoa
                    acabava de escolher e estava tentando entender o que
                    escolheu. Escolhida, herda a cor do botao com opacidade. */}
                {o.descricao && (
                  <span
                    className={ativa ? undefined : "muted"}
                    style={{ fontSize: 11, marginLeft: 6, opacity: ativa ? 0.85 : undefined }}
                  >
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
              {/* ⚠️ AUSENTE, e nao desabilitado -- e aqui pesa mais que no
                  renomear: apagar quadro apaga as tarefas dentro. A lente e o
                  Quadro geral nunca chegam aqui (`opcoesDoSeletor`). */}
              {o.podeApagar && (
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12, color: "var(--danger)" }}
                  onClick={() => abrirApagar(o)}
                  aria-label={`Apagar ${o.nome}`}
                >
                  Apagar
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

      {/* ⚠️ FORA DO FORMULARIO DE RENOMEAR, de proposito. Este aviso nasce
          DEPOIS de o dialogo fechar, e o formulario esta fechado nessa hora --
          desenha-lo la dentro escreveria a mensagem para ninguem. */}
      {divergencia && (
        <div role="alert" className="error-text" style={{ fontSize: 12 }}>
          {divergencia}
        </div>
      )}

      {apagando && (
        <ConfirmarExclusaoDeQuadro
          nome={apagando.nome}
          contagem={contagem}
          erro={erroApagar}
          ocupado={excluindo}
          onConfirmar={confirmarExclusao}
          onCancelar={() => {
            setApagando(null);
            setContagem(null);
            setErroApagar(null);
          }}
        />
      )}

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
