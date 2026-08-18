"use client";
import { useEffect, useRef, useState } from "react";

import {
  ApiError,
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
} from "@/lib/seletorDeQuadro";

/**
 * Spec 036, fatia 10 -- RENOMEAR e APAGAR o quadro, na barra do modo de edicao.
 *
 * ⚠️ SAIU DO `SeletorDeQuadro` EM 18/08, E NAO E MUDANCA COSMETICA. Ate aqui os
 * dois botoes moravam ao lado de CADA quadro na linha do seletor, que por isso
 * crescia `1 + 2N + 1` botoes para N quadros -- e a fatia 7 dobrou a conta ao
 * acrescentar o "Apagar" junto do "Renomear" que ja existia. Com um quadro so
 * em producao isso era invisivel; passava a doer no primeiro quadro criado, que
 * e exatamente o que este deploy libera.
 *
 * ⚠️ ESTE COMPONENTE NAO DECIDE QUEM PODE O QUE. Quem responde e
 * `lib/seletorDeQuadro.ts` (`opcoesDoSeletor` -> `podeRenomear`/`podeApagar`),
 * puro e testado isolado. Aqui so ha desenho e o vaivem com a API. E a
 * fronteira da Spec 027.
 *
 * ⚠️ DERIVA AS OPCOES AQUI, e nao recebe `OpcaoDeQuadro` pronta da pagina. O
 * `include` do `vitest.config.ts` e so `lib/**` e `components/**`: regra escrita
 * dentro de `app/` nasce sem guardiao nenhum. Chamar a MESMA funcao pura em dois
 * componentes nao e uma segunda definicao da regra -- passar a derivacao para a
 * pagina seria.
 *
 * ⚠️ NAO E SEGURANCA. O backend recusa com 403 (`_assert_pode_gerir`) e com 422
 * (`quadro_padrao_nao_apagavel`); isto so evita oferecer botao que nao
 * funcionaria.
 */
export default function AcoesDoQuadro({
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
  onMudou: () => void;
}) {
  const opcoes = opcoesDoSeletor(quadros, teamId, podeGerir);
  const atual = opcaoSelecionada(opcoes, selecionado);

  // ---- renomear ----
  const [renomeando, setRenomeando] = useState(false);
  const [nome, setNome] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const campoRef = useRef<HTMLInputElement>(null);

  // ---- apagar (fatia 7) ----
  //
  // ⚠️ ESTADO SEPARADO DO DE RENOMEAR, e nao um enum compartilhado. As duas
  // operacoes tem confirmacoes de peso OPOSTO: renomear salva no Enter; apagar
  // exige digitar o nome e nem aceita Enter. Compartilhar a maquina de estado
  // faria um caminho herdar as teclas do outro. Herdado do `SeletorDeQuadro`,
  // onde a separacao nasceu.
  const [apagando, setApagando] = useState(false);
  const [contagem, setContagem] = useState<number | null>(null);
  const [erroApagar, setErroApagar] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  // ⚠️ ESTADO PROPRIO, E NAO O `erro`. O `erro` so e desenhado DENTRO do campo
  // de renomear -- pendurar o aviso de divergencia nele fazia a mensagem ser
  // escrita e nunca aparecer, porque o campo esta fechado quando alguem apaga.
  // Pego por teste, nao por leitura.
  const [divergencia, setDivergencia] = useState<string | null>(null);

  useEffect(() => {
    if (renomeando) campoRef.current?.focus();
  }, [renomeando]);

  function abrirRenomear() {
    if (atual.id === null) return; // a lente nao se renomeia
    setRenomeando(true);
    setNome(atual.nome);
    setErro(null);
  }

  function fecharRenomear() {
    setRenomeando(false);
    setNome("");
    setErro(null);
  }

  async function salvar() {
    if (atual.id === null) return;
    // ⚠️ VALIDA ANTES DE MANDAR. Mesma regra do backend
    // (`BoardService._nome_valido`), e a duplicacao existe para nao gastar uma
    // requisicao que ja se sabe que volta 422.
    const limpo = nomeDeQuadroValido(nome);
    if (limpo === null) {
      setErro("O nome não pode ficar vazio e tem no máximo 255 caracteres.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      await renameBoard(atual.id, limpo);
      fecharRenomear();
      onMudou();
    } catch (e) {
      // ⚠️ A MENSAGEM DO BACKEND VEM PRIMEIRO -- ela e quem distingue "sem
      // permissao neste time" de "nome duplicado" (fatia 9).
      setErro((e as ApiError).message || "Não consegui salvar. Tente de novo.");
    } finally {
      setSalvando(false);
    }
  }

  async function abrirApagar() {
    if (atual.id === null) return;
    setApagando(true);
    setContagem(null);
    setErroApagar(null);
    setDivergencia(null);
    try {
      // ⚠️ A CONTAGEM E BUSCADA AO ABRIR, e nao guardada da listagem: o
      // `GET /boards` nao a traz. Enquanto nao chega, confirmar fica travado --
      // confirmar sem saber quantas tarefas vao junto e o que este dialogo
      // existe para impedir.
      const detalhe = await getBoard(atual.id);
      setContagem(detalhe.task_count);
    } catch (e) {
      setErroApagar(
        (e as ApiError).message ||
          "Não consegui contar as tarefas deste quadro."
      );
    }
  }

  async function confirmarExclusao() {
    if (atual.id === null) return;
    setExcluindo(true);
    setErroApagar(null);
    try {
      const { tarefas_apagadas } = await deleteBoard(atual.id);
      const anterior = contagem;
      setApagando(false);
      setContagem(null);
      // ⚠️ SAI DO QUADRO APAGADO ANTES DE RECARREGAR. Sem isto a tela ficaria
      // pedindo um `boardId` que a lista nao devolve mais -- o "Carregando…"
      // eterno anotado no `Board.tsx`.
      //
      // ⚠️ E ISSO DESMONTA ESTE COMPONENTE: a pagina troca
      // `<Board boardId=…/>` por `<Board subteamId=…/>`, dois ramos de um
      // ternario. Por isso a DIVERGENCIA abaixo quase nunca chega a ser vista
      // aqui -- ela sobrevive so no caminho de erro, em que nao houve troca.
      onSelecionar(null);
      onMudou();
      // ⚠️ A DIVERGENCIA E AVISADA, e nao engolida. A contagem foi lida ao
      // abrir; se alguem criou tarefa no meio, os dois numeros discordam --
      // mesmo desenho da `mensagemDeDivergencia` do lote de colunas.
      if (anterior !== null && anterior !== tarefas_apagadas) {
        setDivergencia(
          `O aviso falava em ${anterior}, mas ${tarefas_apagadas} ` +
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

  // ⚠️ NADA A OFERECER NA LENTE, e o retorno vazio e a forma certa. A lente nao
  // tem registro no banco: nao ha o que renomear nem o que apagar. Desenhar os
  // botoes desabilitados aqui seria afordancia que nao funciona (ADR 0034
  // item 2).
  if (!atual.podeRenomear && !atual.podeApagar) return null;

  if (renomeando) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <input
          ref={campoRef}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") salvar();
            if (e.key === "Escape") fecharRenomear();
          }}
          placeholder="Nome do quadro"
          aria-label="Novo nome do quadro"
          style={{ minWidth: 200, fontSize: 13 }}
        />
        <button className="btn btn-primary" onClick={salvar} disabled={salvando}>
          {salvando ? "Salvando…" : "Salvar"}
        </button>
        <button className="btn btn-ghost" onClick={fecharRenomear} disabled={salvando}>
          Cancelar
        </button>
        {erro && (
          <span role="alert" className="error-text" style={{ fontSize: 12 }}>
            {erro}
          </span>
        )}
      </span>
    );
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {/* ⚠️ OS GATILHOS SOMEM ENQUANTO O DIALOGO ESTA ABERTO, e nao e enfeite:
          o botao de CONFIRMAR dentro do `ConfirmarExclusaoDeQuadro` tambem se
          chama "Apagar quadro". Com os dois na arvore ao mesmo tempo, quem usa
          leitor de tela ouve dois botoes de mesmo nome com pesos
          completamente diferentes -- um abre um dialogo, o outro apaga as
          tarefas de outras pessoas. Achado escrevendo o teste, que quebrou com
          "found multiple elements". */}
      {!apagando && atual.podeRenomear && (
        // ⚠️ AUSENTE, e nao desabilitado (ADR 0034 item 2).
        <button
          className="btn btn-ghost"
          style={{ fontSize: 12 }}
          onClick={abrirRenomear}
          aria-label={`Renomear ${atual.nome}`}
        >
          Renomear quadro
        </button>
      )}
      {/* ⚠️ AUSENTE, e nao desabilitado -- e aqui pesa mais que no renomear:
          apagar quadro apaga as tarefas dentro, e e a UNICA operacao do produto
          que nao pergunta o destino delas. O Quadro geral e a lente nunca
          chegam aqui: `opcoesDoSeletor` filtra `!q.is_default`, e a lente nasce
          com os dois `false`. */}
      {!apagando && atual.podeApagar && (
        <button
          className="btn btn-ghost"
          style={{ fontSize: 12, color: "var(--danger)" }}
          onClick={abrirApagar}
          aria-label={`Apagar ${atual.nome}`}
        >
          Apagar quadro
        </button>
      )}

      {/* ⚠️ FORA DO CAMPO DE RENOMEAR, de proposito -- ver o comentario do
          estado `divergencia`. */}
      {divergencia && (
        <span role="alert" className="error-text" style={{ fontSize: 12 }}>
          {divergencia}
        </span>
      )}

      {apagando && (
        <ConfirmarExclusaoDeQuadro
          nome={atual.nome}
          contagem={contagem}
          erro={erroApagar}
          ocupado={excluindo}
          onConfirmar={confirmarExclusao}
          onCancelar={() => {
            setApagando(false);
            setContagem(null);
            setErroApagar(null);
          }}
        />
      )}
    </span>
  );
}
