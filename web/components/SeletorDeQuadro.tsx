"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

import { ApiError, createBoard, type Quadro } from "@/lib/api";
import {
  nomeDeQuadroValido,
  opcaoSelecionada,
  opcoesDoSeletor,
  opcoesDoSeletorDaRaiz,
} from "@/lib/seletorDeQuadro";

/**
 * Spec 036, fatia 5b-6 -- o seletor de quadro da tela do time.
 * ⚠️ REDESENHADO NA FATIA 10 (18/08): virou DROPDOWN no titulo.
 *
 * ⚠️ ATE AQUI ERA UMA LINHA DE ABAS, e ela crescia `1 + 2N + 1` botoes para N
 * quadros -- um por quadro, mais "Renomear" e "Apagar" ao lado de CADA um
 * (a fatia 7 acrescentou o segundo), mais "+ Novo quadro". Com um quadro so em
 * producao isso era invisivel, e passava a doer no primeiro quadro criado.
 * Agora o NOME DO QUADRO e o gatilho, e a linha separada sumiu -- uma dobra
 * inteira de volta.
 *
 * ⚠️ RENOMEAR E APAGAR NAO MORAM MAIS AQUI. Foram para `AcoesDoQuadro`, na
 * barra do MODO DE EDICAO (decisao da Camila, 18/08). Aqui sobrou o que o
 * dropdown e: ESCOLHER, e CRIAR.
 *
 * ⚠️ ESTE COMPONENTE NAO DECIDE NADA. Quem lista, ordena, filtra e diz o que
 * tem afordancia e `lib/seletorDeQuadro.ts`, puro e testado isolado -- e os 38
 * testes dele NAO mudaram nesta fatia, porque ele nao sabe como a tela desenha.
 * E a fronteira da Spec 027 pagando o que prometia.
 *
 * ⚠️ ELE E O SEGUNDO NIVEL DE NAVEGACAO, e nao o primeiro. Quem escolhe o TIME
 * e a barra lateral (`AppShell`, accordion "Quadros": `/quadro` para o Quadro
 * geral, mais uma sub-aba por subtime da lente). Este dropdown escolhe, DENTRO
 * de um subtime, entre a LENTE e os quadros AVULSOS dele. ⚠️ Decisao da Camila
 * em 18/08: os dois CONVIVEM -- o dropdown NAO lista subtimes, e listar
 * exigiria o `computeLens` aqui, que e outra fatia.
 *
 * ⚠️ A LENTE NAO E UM QUADRO, E ESSA E A DISTINCAO QUE O ARQUIVO INTEIRO EXISTE
 * PARA MANTER. `/quadro/[teamId]` mostra o espelho do Quadro geral filtrado por
 * pessoa (ADR 0034) -- nao ha registro no banco, nao ha `board_id`, e nao ha o
 * que renomear. Ela aparece no MESMO dropdown que os quadros avulsos porque
 * para quem usa sao dois lugares onde a tarefa pode estar; mas so um dos dois
 * tem afordancia de editar.
 */
export default function SeletorDeQuadro({
  teamId,
  quadros,
  selecionado,
  podeGerir,
  onSelecionar,
  onMudou,
  daRaiz = false,
}: {
  teamId: string;
  quadros: readonly Quadro[];
  /** `null` = a lente. Ver `OpcaoDeQuadro.id`. */
  selecionado: string | null;
  podeGerir: boolean;
  onSelecionar: (id: string | null) => void;
  /**
   * Chamado depois de criar, para a tela recarregar a lista.
   *
   * ⚠️ O PAI RECARREGA, e este componente NAO guarda a lista. `listBoards` nao
   * e memoizada de proposito (ver `lib/__tests__/quadros.test.ts`), e duas
   * copias da lista divergiriam no primeiro erro de rede.
   */
  onMudou: (quadroNovo?: Quadro) => void;
  /**
   * Esta e a tela da RAIZ (Spec 036, fatia 5c).
   *
   * ⚠️ MUDA QUEM E A PRIMEIRA OPCAO, e nao e cosmetico. Na tela de um subtime
   * o primeiro item e a LENTE, e o Quadro geral fica FORA da lista porque ela
   * ja o representa. Na raiz nao ha lente: o Quadro geral e a coisa em si, e
   * entra pelo nome dele. Ver `opcoesDoSeletorDaRaiz`.
   *
   * ⚠️⚠️ OBRIGATORIA DESDE 11/09, E A MUDANCA E O CONSERTO. Ela era
   * `daRaiz?: boolean`, e a rota `/quadro/[teamId]` simplesmente NAO a passava
   * -- entao uma raiz aberta por ali mostrava "Lente do time" no cabecalho.
   * Reportado por ela com captura, estando no Comercial.
   *
   * ⚠️ E O DEFEITO MORAVA EM `app/`, que esta fora do `include` do vitest: nem
   * teste de componente nem de lib alcancavam a omissao. Tornar a prop
   * obrigatoria transforma o `tsc` no guardiao -- e ele apontou os dois
   * chamadores na hora. Booleano OPCIONAL que muda comportamento e um default
   * escondendo uma pergunta que alguem tem de responder.
   */
  daRaiz: boolean;
}) {
  const opcoes = daRaiz
    ? opcoesDoSeletorDaRaiz(quadros, teamId, podeGerir)
    : opcoesDoSeletor(quadros, teamId, podeGerir);
  const atual = opcaoSelecionada(opcoes, selecionado);

  const [aberto, setAberto] = useState(false);
  const painelRef = useRef<HTMLDivElement>(null);

  // ---- criar quadro ----
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const campoRef = useRef<HTMLInputElement>(null);

  // ⚠️ MESMO PADRAO DO PAINEL DE FILTROS (`Board.tsx:252`), e nao o
  // `useFecharAoClicarFora`. Aquele existe para MODAL: ele pareia `mousedown`
  // com `mouseup` porque selecionar texto dentro do card e soltar fora fechava
  // o modal e apagava formulario (defeito de 31/07, com captura). Dropdown nao
  // tem texto para selecionar dentro, e o painel de filtros -- que e o irmao
  // visual disto -- usa este padrao.
  useEffect(() => {
    if (!aberto) return;
    function onDown(e: MouseEvent) {
      if (painelRef.current && !painelRef.current.contains(e.target as Node)) {
        setAberto(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [aberto]);

  useEffect(() => {
    if (criando) campoRef.current?.focus();
  }, [criando]);

  function escolher(id: string | null) {
    setAberto(false);
    onSelecionar(id);
  }

  function abrirNovo() {
    // ⚠️ FECHA O DROPDOWN AO ABRIR O CAMPO. O campo nasce ABAIXO do gatilho, no
    // lugar do painel: deixar os dois abertos poria um input dentro de um menu
    // que fecha ao clicar fora -- e o "fora" incluiria o proprio campo em
    // qualquer refatoracao futura da arvore.
    setAberto(false);
    setCriando(true);
    setNome("");
    setErro(null);
  }

  function fecharNovo() {
    setCriando(false);
    setNome("");
    setErro(null);
  }

  async function salvar() {
    // ⚠️ VALIDA ANTES DE MANDAR. Mesma regra do backend
    // (`BoardService._nome_valido`), para nao gastar requisicao que ja se sabe
    // que volta 422.
    const limpo = nomeDeQuadroValido(nome);
    if (limpo === null) {
      setErro("O nome não pode ficar vazio e tem no máximo 255 caracteres.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const quadro = await createBoard({ name: limpo, team_id: teamId });
      fecharNovo();
      // ⚠️ SELECIONA O QUE ACABOU DE NASCER. Criar e continuar na lente
      // deixaria a pessoa sem sinal de que algo aconteceu -- o quadro novo
      // ficaria escondido atras de mais um clique.
      onSelecionar(quadro.id);
      onMudou(quadro);
    } catch (e) {
      // ⚠️ A MENSAGEM DO BACKEND VEM PRIMEIRO. Ela e quem distingue "sem
      // permissao neste time" de "nome duplicado" (fatia 9) -- texto fixo aqui
      // esconderia a causa de quem esta olhando a tela.
      setErro((e as ApiError).message || "Não consegui salvar. Tente de novo.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 6 }}>
      <span ref={painelRef} style={{ position: "relative", display: "inline-flex" }}>
        {/* ⚠️ O GATILHO E O TITULO, e por isso ele herda o tamanho do `<h1>` em
            vez de parecer um botao. O `Board` desenha `<h1>{title}</h1>` e este
            componente E o `title` -- ver a prop `title: ReactNode` la.

            ⚠️ `aria-haspopup="listbox"` + `aria-expanded` E O CONTRATO CERTO
            AQUI, diferente da linha de abas que isto substituiu. Aquela usava
            `role="group"` com `aria-pressed` justamente por NAO ser um menu:
            eram botoes lado a lado. Agora e um gatilho que abre uma lista, que
            e o que estes dois anunciam. */}
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={aberto}
          aria-label={`Quadro: ${atual.nome}. Trocar de quadro`}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            background: "none", border: "none", padding: 0, cursor: "pointer",
            // ⚠️⚠️ AQUI HAVIA `font: "inherit", fontSize: 19` -- E ISSO PRENDIA
            // O TITULO DO QUADRO NO TAMANHO DE ANTES DA SPEC 039.
            //
            // O `Board` desenha `<h1 style={{ fontSize: 26 }}>{title}</h1>` e
            // este botao E o `title`. O `fontSize: 19` vinha DEPOIS do atalho
            // `font`, entao ganhava dele -- e o titulo continuou 19px enquanto
            // a F1 acreditava te-lo levado a 26. Medido no navegador em 22/08:
            // `getComputedStyle` do gatilho devolvia **19px** dentro de um h1
            // de 26.
            //
            // ⚠️ E ELE SAIA TORTO NA LINHA, que foi como a Camila achou. O h1
            // reserva a caixa de 26px, o texto desenha 19: o centro optico do
            // titulo caia em 43,70 enquanto TODOS os vizinhos (selo, botoes)
            // caiam em 42,00 -- 1,7px abaixo, o suficiente para a linha
            // parecer desalinhada. Com o conserto: 41,02 contra 42,00, que e
            // arredondamento e nao desalinho.
            //
            // ⚠️ TERCEIRA VEZ DESTE MESMO ATALHO no projeto: ele ja tinha
            // matado o `fontSize` da pilula de datas (F7) e esta registrado no
            // `web/AGENTS.md`. `font` e ATALHO -- ele redefine tamanho, peso e
            // altura de linha junto com a familia, e qualquer coisa antes dele
            // some. Aqui nem era preciso: o `globals.css` ja tem
            // `button { font-family: inherit }`.
            fontSize: "inherit", fontWeight: "inherit", lineHeight: "inherit",
            letterSpacing: "-0.02em",
            color: "var(--text)",
          }}
        >
          {atual.nome}
          {/* Cresceu junto com o titulo: 16 ao lado de 26px ficava miudo. */}
          <ChevronDown size={20} style={{ opacity: 0.6, flexShrink: 0 }} />
        </button>

        {aberto && (
          <div
            role="listbox"
            aria-label="Quadros deste time"
            style={{
              position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 40,
              minWidth: 240, background: "var(--surface)",
              border: "1px solid var(--border)", borderRadius: 12,
              boxShadow: "var(--shadow)", padding: 6,
              display: "flex", flexDirection: "column", gap: 2,
            }}
          >
            {opcoes.map((o) => {
              const ativa = o.id === atual.id;
              return (
                <button
                  key={o.id ?? "lente"}
                  type="button"
                  role="option"
                  aria-selected={ativa}
                  onClick={() => escolher(o.id)}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "flex-start",
                    gap: 2, width: "100%", textAlign: "left",
                    background: ativa ? "var(--accent-soft)" : "none",
                    border: "none", borderRadius: 8, padding: "7px 10px",
                    cursor: "pointer", font: "inherit", fontSize: 13,
                    color: ativa ? "var(--accent)" : "var(--text)",
                    fontWeight: ativa ? 600 : 400,
                  }}
                >
                  {o.nome}
                  {/* ⚠️ A DESCRICAO DA LENTE NAO PODE SER `--text-faint` SOBRE O
                      FUNDO ESCOLHIDO. Medido na versao de abas: cinza
                      `--text-faint` sobre o azul do `btn-primary` dava 1.68 no
                      tema claro e 1.32 no escuro, contra os 4.5 que AA pede --
                      nao era "dificil de ler", era invisivel. E logo AQUI: esta
                      frase e o que explica a diferenca entre a lente e um
                      quadro proprio, e sumia exatamente quando a pessoa acabava
                      de escolher. Escolhida, herda a cor do item com opacidade.
                      ⚠️ O fundo mudou de `btn-primary` para `--accent-soft`, que
                      e mais claro -- entao o problema original nao se repetiria
                      aqui; a regra fica porque o remedio e o mesmo e mais
                      barato que remedir. */}
                  {o.descricao && (
                    <span
                      className={ativa ? undefined : "muted"}
                      style={{ fontSize: 11, opacity: ativa ? 0.85 : undefined }}
                    >
                      {o.descricao}
                    </span>
                  )}
                </button>
              );
            })}

            {/* ⚠️ "+ Novo quadro" DENTRO DO DROPDOWN (decisao da Camila,
                18/08), e separado por uma linha: ele nao e uma opcao de
                escolha, e o `role="option"` acima anunciaria que e. Por isso
                fica FORA da lista de opcoes, depois do separador. */}
            {podeGerir && (
              <>
                <span
                  aria-hidden="true"
                  style={{ height: 1, background: "var(--border)", margin: "4px 6px" }}
                />
                <button
                  type="button"
                  onClick={abrirNovo}
                  style={{
                    width: "100%", textAlign: "left", background: "none",
                    border: "none", borderRadius: 8, padding: "7px 10px",
                    cursor: "pointer", font: "inherit", fontSize: 13,
                    color: "var(--accent)",
                  }}
                >
                  + Novo quadro
                </button>
              </>
            )}
          </div>
        )}
      </span>

      {criando && (
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            ref={campoRef}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") salvar();
              if (e.key === "Escape") fecharNovo();
            }}
            placeholder="Nome do quadro"
            aria-label="Nome do novo quadro"
            style={{ minWidth: 220, fontSize: 13 }}
          />
          <button className="btn btn-primary" onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando…" : "Criar"}
          </button>
          <button className="btn btn-ghost" onClick={fecharNovo} disabled={salvando}>
            Cancelar
          </button>
          {erro && (
            <span role="alert" className="error-text" style={{ fontSize: 12 }}>
              {erro}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
