"use client";
import { useEffect, useRef, useState } from "react";

import {
  ApiError,
  apagarColuna,
  colunaComContagem,
  criarColuna,
  renomearColuna,
} from "@/lib/api";
import type { Coluna } from "@/lib/coluna";
import {
  avisoDeExclusao,
  CODIGO_SEM_DESTINO,
  destinosPara,
  ROTULO_DA_SEMANTICA,
  explicaRecusa,
  impedimentoDeExclusao,
  mensagemDeDivergencia,
} from "@/lib/edicaoDeColunas";

/**
 * Spec 036, fatia 5b-6 -- o modo de EDICAO DE COLUNAS de um quadro avulso.
 *
 * ⚠️ ESTE COMPONENTE NAO DECIDE NADA. Quem diz se uma coluna pode ser apagada,
 * quais destinos oferecer, o que o aviso escreve e como traduzir a recusa do
 * backend e `lib/edicaoDeColunas.ts`, puro e testado isolado. Aqui so ha
 * desenho e o vaivem com a API -- fronteira da Spec 027.
 *
 * ⚠️ E UM MODO, E NAO UM MENU POR COLUNA (decisao de 12/08). Um "⋯" em cada
 * cabecalho seria ruido permanente em todas as colunas para uma acao usada
 * talvez uma vez por trimestre. E, o que pesou mais: REORDENAR COLUNA (fatia
 * seguinte) nao cabe num menu -- arrastar cabecalho exige o quadro em modo de
 * edicao, senao os cabecalhos viram alvo de arraste o tempo todo e colidem com
 * o arraste de CARD, que e a interacao principal. Nascer com menu obrigaria a
 * reformar tudo uma fatia depois.
 *
 * ⚠️ SO EM QUADRO AVULSO. As colunas do Quadro geral nao se mexem enquanto a
 * 5c nao existir (`BoardService._assert_quadro_editavel`, 422): sao 176
 * tarefas vivas e nao ha tela que desfaca. Quem renderiza este componente e
 * responsavel por nao o mostrar la.
 */
export default function EditorDeColunas({
  boardId,
  colunas,
  onMudou,
  onFechar,
}: {
  boardId: string;
  colunas: readonly Coluna[];
  /** Recarrega os quadros no pai. O estado da lista NAO mora aqui. */
  onMudou: () => void;
  onFechar: () => void;
}) {
  const [nome, setNome] = useState("");
  // ⚠️ A SEMANTICA E ESCOLHIDA NA CRIACAO, e so nela. Criar e seguro: a coluna
  // nasce VAZIA, entao nenhuma tarefa muda de significado. Editar depois nao
  // e -- a semantica decide cascata de conclusao, varredura de arquivamento,
  // proporcao da checklist e aviso de prazo, os quatro em silencio, e trocar
  // com tarefas dentro mudaria o sentido delas sem uma linha de historico.
  const [semantica, setSemantica] = useState<Coluna["semantic"]>("IN_PROGRESS");
  const [criandoAgora, setCriandoAgora] = useState(false);
  const [renomeando, setRenomeando] = useState<string | null>(null);
  const [nomeNovo, setNomeNovo] = useState("");
  // O fluxo de apagar, em dois passos: contar e depois confirmar.
  const [apagando, setApagando] = useState<Coluna | null>(null);
  const [quantas, setQuantas] = useState<number | null>(null);
  // ⚠️ O BACKEND RECUSOU POR FALTA DE DESTINO NUMA COLUNA QUE A CONTAGEM DIZ
  // ESTAR VAZIA. Acontece quando a coluna guarda tarefas APAGADAS: a contagem
  // conta so as vivas (de proposito -- tarefa apagada nao existe para quem
  // olha), mas o `DELETE` precisa mover as apagadas junto por causa da FK
  // `RESTRICT`. Sem este estado, a tela mostrava o erro e NAO desenhava o
  // seletor, e a coluna nao podia mais ser apagada pelo produto.
  const [exigeDestino, setExigeDestino] = useState(false);
  const dialogoRef = useRef<HTMLDivElement | null>(null);
  const [destinoId, setDestinoId] = useState<string>("");
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  /**
   * ⚠️ LE O `code`, E NUNCA A MENSAGEM. As duas recusas de apagar coluna sao
   * 422; so o codigo as separa. `explicaRecusa` devolve `null` para codigo
   * desconhecido, e aí a mensagem do backend passa -- inventar texto proprio
   * para erro que nao previmos esconderia a causa.
   */
  function mostrarErro(e: unknown) {
    const err = e as ApiError;
    setErro(explicaRecusa(err.code) ?? err.message ?? "Não consegui salvar.");
  }

  async function criar() {
    const limpo = nome.trim();
    if (!limpo) return;
    setOcupado(true);
    setErro(null);
    try {
      await criarColuna(boardId, { name: limpo, semantic: semantica });
      setNome("");
      setSemantica("IN_PROGRESS");
      setCriandoAgora(false);
      onMudou();
    } catch (e) {
      mostrarErro(e);
    } finally {
      setOcupado(false);
    }
  }

  async function renomear(coluna: Coluna) {
    const limpo = nomeNovo.trim();
    if (!limpo) return;
    setOcupado(true);
    setErro(null);
    try {
      await renomearColuna(boardId, coluna.id, limpo);
      setRenomeando(null);
      onMudou();
    } catch (e) {
      mostrarErro(e);
    } finally {
      setOcupado(false);
    }
  }

  /**
   * Passo 1 de apagar: descobrir QUANTAS tarefas tem dentro.
   *
   * ⚠️ O NUMERO ENVELHECE ENTRE ESTA CHAMADA E O `DELETE`, e isso e aceito.
   * Alguem pode mover uma tarefa para ca no meio; `mensagemDeDivergencia`
   * cuida do caso.
   */
  async function abrirExclusao(coluna: Coluna) {
    setErro(null);
    setAviso(null);
    setApagando(coluna);
    setQuantas(null);
    setDestinoId("");
    setExigeDestino(false);
    try {
      const detalhe = await colunaComContagem(boardId, coluna.id);
      setQuantas(detalhe.task_count);
    } catch (e) {
      mostrarErro(e);
      setApagando(null);
    }
  }

  async function confirmarExclusao() {
    if (!apagando || quantas === null) return;
    setOcupado(true);
    setErro(null);
    try {
      const movidas = await apagarColuna(
        boardId,
        apagando.id,
        destinoId || undefined,
      );
      // ⚠️ O NUMERO QUE VALE E O DO `DELETE`, e nao o do aviso.
      setAviso(mensagemDeDivergencia(quantas, movidas));
      setApagando(null);
      setQuantas(null);
      onMudou();
    } catch (e) {
      // ⚠️ SO ESTE CAMINHO LIGA `exigeDestino`, e so com o CODIGO. A outra
      // recusa de apagar coluna tambem e 422; distinguir pela mensagem
      // acoplaria a tela ao portugues do backend.
      if ((e as ApiError).code === CODIGO_SEM_DESTINO) setExigeDestino(true);
      mostrarErro(e);
    } finally {
      setOcupado(false);
    }
  }

  // ⚠️ O DIALOGO NAO E MODAL -- ele e um bloco no fim deste painel, e a lista
  // de colunas continua acima e clicavel. Sem esta trava dava para abrir
  // "Apagar" de OUTRA coluna com o dialogo aberto: ele trocava de assunto no
  // mesmo lugar, com o mesmo formato e o mesmo botao na mesma posicao. Quem
  // tivesse acabado de ler "isto vai marcar 40 tarefas como concluidas"
  // confirmaria sobre outra coluna sem perceber a troca.
  //
  // ⚠️ VALE PARA O PAINEL INTEIRO, e nao so para o botao de apagar: renomear e
  // criar coluna tambem mudam a lista de destinos que o dialogo esta
  // oferecendo naquele instante.
  // ⚠️ UMA SO SAIDA DO DIALOGO, usada pelo botao E pelo Esc. Estava inline no
  // "Cancelar" e esquecia `exigeDestino` e `erro`: reabrir a mesma coluna
  // depois de uma recusa trazia o seletor de destino ja aberto e o erro
  // antigo na tela, sobre uma contagem que ainda nem chegou.
  function cancelarExclusao() {
    setApagando(null);
    setQuantas(null);
    setDestinoId("");
    setExigeDestino(false);
    setErro(null);
  }

  const travado = ocupado || apagando !== null;

  // ⚠️ O FOCO PRECISA IR PARA O DIALOGO, senao quem usa leitor de tela nao e
  // avisado de que ele apareceu: `role="dialog"` num bloco que so aparece na
  // arvore nao anuncia nada sozinho. E o dialogo nasce no FIM do painel, entao
  // mesmo quem enxerga pode nao ve-lo se a lista de colunas for longa -- levar
  // o foco rola a pagina ate ele de graca.
  useEffect(() => {
    if (apagando) dialogoRef.current?.focus();
  }, [apagando]);
  const destinos = apagando ? destinosPara(apagando, colunas) : [];
  const destinoEscolhido =
    destinos.find((c) => c.id === destinoId) ?? null;
  const avisoAtual = apagando
    ? avisoDeExclusao({
        coluna: apagando,
        destino: destinoEscolhido,
        quantas: quantas ?? 0,
        exigeDestino,
      })
    : null;
  // ⚠️ Coluna vazia some direto -- MENOS quando o backend ja recusou por falta
  // de destino. Sem o `&& !exigeDestino`, o botao continuaria liberado e cada
  // clique repetiria o mesmo 422.
  const podeConfirmar =
    apagando !== null &&
    quantas !== null &&
    ((quantas === 0 && !exigeDestino) || destinoEscolhido !== null);

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 14,
        marginBottom: 14,
        background: "var(--surface-2)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong style={{ fontSize: 14 }}>Editando as colunas</strong>
        {/* ⚠️ `ocupado`, E NAO `travado`: sair nao e destrutivo, e prender a
            saida com o dialogo aberto e uma armadilha. Fechar o painel some
            com o dialogo, que e o mesmo efeito de cancelar. */}
        <button className="btn btn-ghost" onClick={onFechar} disabled={ocupado}>
          Concluir edição
        </button>
      </div>

      {aviso && (
        <div role="status" className="muted" style={{ fontSize: 13 }}>
          {aviso}
        </div>
      )}
      {erro && (
        <div role="alert" className="error-text" style={{ fontSize: 13 }}>
          {erro}
        </div>
      )}

      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {colunas.map((c) => {
          const impedimento = impedimentoDeExclusao(c, colunas);
          return (
            <li key={c.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {renomeando === c.id ? (
                <>
                  <input
                    value={nomeNovo}
                    onChange={(e) => setNomeNovo(e.target.value)}
                    aria-label={`Novo nome de ${c.name}`}
                    style={{ minWidth: 180 }}
                  />
                  <button className="btn btn-primary" onClick={() => renomear(c)} disabled={travado}>
                    Salvar
                  </button>
                  <button className="btn btn-ghost" onClick={() => setRenomeando(null)} disabled={travado}>
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <span style={{ minWidth: 180, fontSize: 14 }}>{c.name}</span>
                  {/* ⚠️ A SEMANTICA, VISIVEL E NAO EDITAVEL. Sem ela a lista
                      mostra oito nomes iguais e uma delas, sem explicacao, nao
                      pode ser apagada. Editar esta fora de proposito: a
                      semantica decide cascata, arquivamento, checklist e prazo
                      -- os quatro em silencio. */}
                  <span
                    className="muted"
                    style={{ fontSize: 12, minWidth: 110 }}
                    title="O tipo da coluna decide o que o sistema faz sozinho com as tarefas dela. Não é editável."
                  >
                    {ROTULO_DA_SEMANTICA[c.semantic] ?? c.semantic}
                  </span>
                  <button
                    className="btn btn-ghost"
                    aria-label={`Renomear ${c.name}`}
                    onClick={() => {
                      setRenomeando(c.id);
                      setNomeNovo(c.name);
                    }}
                    disabled={travado}
                  >
                    Renomear
                  </button>
                  {/* ⚠️ AUSENTE, E NAO DESABILITADO, quando a coluna nao pode
                      ir -- mas com o MOTIVO no lugar. Botao desabilitado sem
                      explicacao e alguem clicando e perguntando por que nada
                      acontece; texto sem botao diz o que fazer antes. */}
                  {impedimento ? (
                    <span className="muted" style={{ fontSize: 12 }}>
                      {impedimento.motivo}
                    </span>
                  ) : (
                    <button
                      className="btn btn-ghost"
                      aria-label={`Apagar ${c.name}`}
                      onClick={() => abrirExclusao(c)}
                      disabled={travado}
                    >
                      Apagar
                    </button>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>

      {criandoAgora ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome da coluna"
            aria-label="Nome da nova coluna"
            style={{ minWidth: 180 }}
          />
          <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
            Tipo:
            <select
              value={semantica}
              onChange={(e) =>
                setSemantica(e.target.value as Coluna["semantic"])
              }
              aria-label="Tipo da nova coluna"
            >
              {(Object.keys(ROTULO_DA_SEMANTICA) as Coluna["semantic"][]).map(
                (s) => (
                  <option key={s} value={s}>
                    {ROTULO_DA_SEMANTICA[s]}
                  </option>
                ),
              )}
            </select>
          </label>
          {/* ⚠️ DIZ O QUE O TIPO DECIDE, em vez de deixar a pessoa adivinhar.
              Ele nao muda depois -- e a unica chance de escolher e agora. */}
          <span className="muted" style={{ fontSize: 12, maxWidth: 260 }}>
            O tipo decide o que o sistema faz sozinho com as tarefas desta
            coluna, e não muda depois.
          </span>
          <button className="btn btn-primary" onClick={criar} disabled={travado}>
            Criar
          </button>
          <button className="btn btn-ghost" onClick={() => setCriandoAgora(false)} disabled={travado}>
            Cancelar
          </button>
        </div>
      ) : (
        <div>
          <button className="btn btn-ghost" onClick={() => setCriandoAgora(true)} disabled={travado}>
            + Nova coluna
          </button>
        </div>
      )}

      {apagando && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Apagar a coluna ${apagando.name}`}
          ref={dialogoRef}
          // ⚠️ `-1` E NAO `0`: o dialogo tem de RECEBER foco por script, mas
          // nao pode entrar na ordem do Tab -- senao a pessoa tabula para um
          // contentor que nao faz nada.
          tabIndex={-1}
          // ⚠️ ESC FECHA, e ate 13/08 nao fechava. O unico jeito de sair era
          // achar o botao "Cancelar" no fim do bloco.
          onKeyDown={(e) => {
            if (e.key === "Escape" && !ocupado) {
              e.stopPropagation();
              cancelarExclusao();
            }
          }}
          style={{
            border: `1px solid ${avisoAtual?.terminal ? "var(--danger)" : "var(--border)"}`,
            borderRadius: 10,
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {quantas === null ? (
            <span className="muted">Contando as tarefas…</span>
          ) : (
            <>
              {avisoAtual ? (
                <>
                  <strong style={{ fontSize: 14 }}>{avisoAtual.titulo}</strong>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                    {avisoAtual.linhas.map((linha) => (
                      <li key={linha}>{linha}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <strong style={{ fontSize: 14 }}>
                  Apagar a coluna &quot;{apagando.name}&quot;? Ela está vazia.
                </strong>
              )}

              {(quantas > 0 || exigeDestino) && (
                <label style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}>
                  Mover para:
                  <select
                    value={destinoId}
                    onChange={(e) => setDestinoId(e.target.value)}
                    aria-label="Coluna de destino"
                  >
                    <option value="">Escolha uma coluna…</option>
                    {destinos.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div style={{ display: "flex", gap: 8 }}>
                {/* ⚠️ VERMELHO, E NAO O AZUL PRIMARIO. Este botao apaga a
                    coluna e, quando o destino e terminal, MARCA AS TAREFAS
                    COMO CONCLUIDAS, cascateia nas subtarefas e joga tudo na
                    fila de arquivamento. Ele nascera `btn-primary`: mesma cor,
                    mesma posicao e mesmo gesto do "Salvar" do renomear, tres
                    linhas acima. Sem confirmacao digitada (decisao consciente
                    -- nada se perde), a cor e a unica defesa. */}
                <button
                  className="btn btn-danger"
                  onClick={confirmarExclusao}
                  disabled={ocupado || !podeConfirmar}
                >
                  {avisoAtual?.rotuloDoBotao ?? "Apagar coluna"}
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={cancelarExclusao}
                  disabled={ocupado}
                >
                  Cancelar
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
