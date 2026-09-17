"use client";
// /formularios/[id] — o editor de seções e perguntas (Spec 043, fatia C2).
//
// ⚠️ ATÉ AQUI DAVA PARA CRIAR UM FORMULÁRIO E MAIS NADA. A fatia C1 entregou a
// lista, e o primeiro formulário criado por ela bateu num beco: "um formulário
// sem perguntas não pode ser publicado", e nenhum lugar onde pôr perguntas.
// Esta tela é a saída daquele beco.
//
// ⚠️ ORDEM POR SETAS, E NÃO POR ARRASTAR, e é uma escolha e não um esquecimento:
// `onDragEnd` não roda em jsdom (AGENTS.md §6), então arrastar aqui nasceria
// sem portão nenhum — num editor em que mover a pergunta errada apaga uma
// condicional. As setas são testáveis, funcionam no teclado, e desabilitam com
// o motivo escrito quando o movimento quebraria alguma coisa.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import Loading from "@/components/Loading";
import { useAvisar } from "@/components/Toasts";
import { withTeam } from "@/lib/activeTeam";
import {
  ApiError,
  apagarPergunta,
  apagarSecao,
  criarPergunta,
  criarSecao,
  definirCondicional,
  definirResumo,
  editarPergunta,
  editarSecao,
  obterFormulario,
  publicarFormulario,
  renomearFormulario,
  reordenarPerguntas,
  reordenarSecoes,
  type FormularioDetalhado,
  type PerguntaDoEditor,
  type SecaoDoEditor,
} from "@/lib/api";
import {
  TIPOS_DE_PERGUNTA,
  alvosPossiveis,
  contaPerguntas,
  dependentesDe,
  exigeOpcoes,
  impedimentoParaMover,
  movido,
  nomeDoTipo,
  ordenadasPorPosicao,
  sugereSlugDeSecao,
} from "@/lib/editorDeFormulario";

export default function EditorPage() {
  return (
    <AppShell>
      <Editor />
    </AppShell>
  );
}

function Editor() {
  const params = useParams<{ id: string }>();
  const formId = params?.id ?? "";

  const [form, setForm] = useState<FormularioDetalhado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const recarregar = useCallback(async () => {
    const novo = await obterFormulario(formId);
    setForm(novo);
    return novo;
  }, [formId]);

  useEffect(() => {
    if (!formId) return;
    obterFormulario(formId)
      .then(setForm)
      .catch((e: ApiError) =>
        setFatal(
          e.status === 404
            ? "Este formulário não existe mais."
            : e.message || "Não consegui carregar o formulário."
        )
      );
  }, [formId]);

  /**
   * ⚠️ TODA ESCRITA PASSA POR AQUI, E RECARREGA O FORMULÁRIO INTEIRO.
   *
   * Parece desperdício e é a decisão certa para esta tela: quase toda ação
   * mexe em mais de uma coisa. Apagar uma pergunta pode limpar o resumo da
   * seção; reordenar renumera todo mundo; apagar uma seção leva as perguntas
   * junto. Costurar cada um desses efeitos no estado local seria manter uma
   * segunda cópia das regras do backend — e a primeira que divergisse mostraria
   * um formulário que não existe.
   */
  async function agir(o_que: () => Promise<unknown>): Promise<boolean> {
    setOcupado(true);
    setErro(null);
    try {
      await o_que();
      await recarregar();
      return true;
    } catch (e) {
      // ⚠️ A MENSAGEM DO BACKEND APARECE INTEIRA. É ela que nomeia a pergunta
      // que travou ("Data da sessão") -- trocá-la por "não consegui" mandaria
      // procurar sozinha entre 108 perguntas qual delas foi.
      setErro((e as ApiError).message || "Não consegui salvar.");
      // ⚠️⚠️ E DEVOLVE `false`, EM VEZ DE SÓ ENGOLIR. Sem isto, `await agir(…)`
      // sempre resolvia com sucesso, e os quatro botões de Salvar limpavam os
      // campos e fechavam o painel **mesmo com o backend recusando**. A pessoa
      // via a mensagem no topo -- aquela que NOMEIA o que travou -- e o texto
      // que ela precisava corrigir já tinha sumido.
      //
      // ⚠️ E ISSO ERA COMUM, não raro: o editor tem oito códigos de recusa
      // (slug repetido, escolha sem alternativa, condicional inválida,
      // dependente…). Cada um atropelava o que a pessoa tinha digitado.
      // Achado pela revisão de 31/08.
      return false;
    } finally {
      setOcupado(false);
    }
  }

  if (fatal) {
    return (
      <div>
        {/* ⚠️ CAMINHO PURO AQUI, e é o único: o formulário não carregou (apagado,
            ou sem acesso), então não há time dele para levar. A lista resolve
            pela reserva -- que é a resposta honesta quando não se sabe. */}
        <Link href="/formularios" className="muted" style={{ fontSize: 13 }}>
          ‹ Formulários
        </Link>
        <div className="error-box" style={{ maxWidth: 520, marginTop: 12 }} role="alert">
          {fatal}
        </div>
      </div>
    );
  }
  if (!form) return <Loading />;

  const secoes = ordenadasPorPosicao(form.sections);
  const total = contaPerguntas(secoes);

  return (
    <div style={{ maxWidth: 900 }}>
      {/* ⚠️ O VOLTAR EXISTE PORQUE ELE JÁ FOI ESQUECIDO UMA VEZ, na tela de
          projeto (Spec 039). Sem ele a única saída é o menu lateral.

          ⚠⚠ E LEVA O TIME DO FORMULÁRIO (14/09). O caminho puro apagava o
          time, e a lista caía na reserva: editando um formulário do Comercial,
          voltar abria os do Marketing. Esta rota não tem `?time=`; quem sabe
          o time certo é o formulário. */}
      <Link
        href={withTeam("/formularios", "", form.team_id)}
        className="muted"
        style={{ fontSize: 13 }}
      >
        ‹ Formulários
      </Link>

      <PageHeader
        title={form.title}
        count={`${total} ${total === 1 ? "pergunta" : "perguntas"} em ${
          secoes.length
        } ${secoes.length === 1 ? "seção" : "seções"}`}
        actions={
          <button
            type="button"
            className="btn btn-primary"
            disabled={ocupado}
            onClick={() =>
              agir(() => publicarFormulario(form.id, !form.is_published))
            }
          >
            {form.is_published ? "Despublicar" : "Publicar"}
          </button>
        }
      />

      <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>
        {form.is_published ? (
          <>
            No ar em <code>/solicitar/{form.slug}</code>.
          </>
        ) : (
          <>
            Rascunho — ainda não aparece em <code>/solicitar</code>.
          </>
        )}
      </p>

      {erro && (
        <div className="error-box" style={{ marginBottom: 14 }} role="alert">
          {erro}
        </div>
      )}

      <Cabecalho form={form} ocupado={ocupado} agir={agir} />

      {secoes.length === 0 && (
        <p className="muted" style={{ fontSize: 14 }}>
          Um formulário é feito de seções — cada uma é um tipo de pedido, e vira
          uma opção na primeira tela de quem solicita. Crie a primeira abaixo.
        </p>
      )}

      {secoes.map((s, i) => (
        <Secao
          key={s.id}
          secao={s}
          indice={i}
          total={secoes.length}
          ocupado={ocupado}
          agir={agir}
          aoMover={(passo) =>
            agir(() =>
              reordenarSecoes(
                form.id,
                movido(secoes, i, passo).map((x) => x.id)
              )
            )
          }
        />
      ))}

      <NovaSecao
        ocupado={ocupado}
        aoCriar={(entrada) => agir(() => criarSecao(form.id, entrada))}
      />
    </div>
  );
}

// =====================================================================
// ⚠️ O cabeçalho -- o que a porta pública mostra ANTES das perguntas
// =====================================================================
/**
 * ⚠️ ESTE PAINEL NASCEU DE "não é todo formulário que chama fazae também e
 * tals, muitas variáveis aí" (Camila, 27/08).
 *
 * Duas coisas estavam presas: o TÍTULO, escrito na mão no componente público
 * mesmo já existindo no banco desde a fatia A -- todo formulário novo abria
 * com o nome do Marketing --, e os CINCO CAMPOS de identificação, fixos e
 * obrigatórios, três deles vocabulário da FECAF.
 */
function Cabecalho({
  form,
  ocupado,
  agir,
}: {
  form: FormularioDetalhado;
  ocupado: boolean;
  agir: (o_que: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [aberto, setAberto] = useState(false);
  const [titulo, setTitulo] = useState(form.title);
  const [descricao, setDescricao] = useState(form.description);
  const [rotulos, setRotulos] = useState({
    phone_label: form.phone_label,
    department_label: form.department_label,
    polo_label: form.polo_label,
  });

  const CAMPOS = [
    { chave: "phone_label" as const, padrao: "Telefone" },
    { chave: "department_label" as const, padrao: "Área / Departamento" },
    { chave: "polo_label" as const, padrao: "Polo" },
  ];

  if (!aberto) {
    return (
      <div
        style={{
          display: "flex", alignItems: "center", gap: 10, marginBottom: 14,
          padding: "10px 16px", borderRadius: 12,
          border: "1px solid var(--border)", background: "var(--surface)",
        }}
      >
        <strong style={{ fontSize: 14 }}>Cabeçalho</strong>
        {/* ⚠️ O RESUMO LÊ O `form`, E NÃO O ESTADO LOCAL. Lendo o estado, ele
            mostrava a intenção descartada como se fosse o que está no banco --
            e essa é a única linha da tela que diz o que o formulário pede
            hoje. */}
        <span className="muted" style={{ fontSize: 12.5, minWidth: 0 }}>
          {form.title}
          {" · pede "}
          {["Nome", "E-mail", ...CAMPOS.map((c) => form[c.chave]).filter(Boolean)]
            .join(", ")}
        </span>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: 12, marginLeft: "auto" }}
          disabled={ocupado}
          onClick={() => setAberto(true)}
        >
          Editar
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        marginBottom: 16, padding: 16, borderRadius: 12,
        border: "1px solid var(--border)", background: "var(--edicao-fundo)",
        display: "flex", flexDirection: "column", gap: 12,
      }}
    >
      <div className="field">
        <label className="label" htmlFor="cab-titulo">
          Título — é o que aparece no topo da página pública
        </label>
        <input
          id="cab-titulo"
          className="input"
          value={titulo}
          maxLength={120}
          onChange={(e) => setTitulo(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="label" htmlFor="cab-desc">
          Texto de abertura
        </label>
        <input
          id="cab-desc"
          className="input"
          placeholder="Identifique-se e selecione o que você precisa."
          value={descricao}
          maxLength={4000}
          onChange={(e) => setDescricao(e.target.value)}
        />
      </div>

      <div className="field">
        <span className="label">O que perguntar a quem solicita</span>
        {/* ⚠️ NOME E E-MAIL APARECEM DESLIGADOS E EXPLICADOS, em vez de
            simplesmente não aparecerem: sem isso, quem procura "por que não
            consigo tirar o e-mail?" não acha resposta em lugar nenhum. */}
        <p className="muted" style={{ fontSize: 12, margin: "2px 0 8px" }}>
          <strong>Nome</strong> e <strong>e-mail</strong> são sempre pedidos: a
          fila é organizada por quem pediu, e é pelo e-mail que a pessoa recebe
          resposta. Os três abaixo você escolhe.
        </p>
        {CAMPOS.map(({ chave, padrao }) => {
          const ligado = rotulos[chave] !== null;
          return (
            <div
              key={chave}
              style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}
            >
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={ligado}
                  onChange={(e) =>
                    setRotulos((r) => ({
                      ...r,
                      [chave]: e.target.checked ? padrao : null,
                    }))
                  }
                />
                Pedir
              </label>
              <input
                className="input"
                style={{ maxWidth: 260 }}
                aria-label={`Nome do campo ${padrao}`}
                value={rotulos[chave] ?? ""}
                placeholder={padrao}
                maxLength={60}
                disabled={!ligado}
                onChange={(e) =>
                  setRotulos((r) => ({ ...r, [chave]: e.target.value }))
                }
              />
              {!ligado && (
                <span className="muted" style={{ fontSize: 12 }}>
                  não aparece no formulário
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button
          type="button"
          className="btn btn-ghost"
          // ⚠️⚠️ CANCELAR TEM DE DESFAZER, e não só fechar. Sem o reset, o
          // estado local guardava a mudança descartada e causava DOIS
          // estragos: o resumo fechado passava a mentir ("não pede mais
          // Polo", com o banco pedindo), e reabrir depois para corrigir uma
          // vírgula no título reenviava `polo_label: null` -- que o backend,
          // por contrato, trata como DESLIGUE. Achado pela revisão de 31/08.
          onClick={() => {
            setTitulo(form.title);
            setDescricao(form.description);
            setRotulos({
              phone_label: form.phone_label,
              department_label: form.department_label,
              polo_label: form.polo_label,
            });
            setAberto(false);
          }}
        >
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={ocupado || !titulo.trim()}
          onClick={async () => {
            await agir(() =>
              // ⚠️ OS TRÊS RÓTULOS VÃO SEMPRE, e é o único jeito: para eles
              // `null` significa DESLIGUE, e o backend distingue "não veio" de
              // "veio null". Como este painel é exatamente onde se decide isso,
              // mandar os três é a intenção.
              renomearFormulario(form.id, {
                title: titulo,
                description: descricao,
                ...rotulos,
              })
            );
            setAberto(false);
          }}
        >
          Salvar cabeçalho
        </button>
      </div>
    </div>
  );
}

// =====================================================================
// Seção
// =====================================================================
function Secao({
  secao,
  indice,
  total,
  ocupado,
  agir,
  aoMover,
}: {
  secao: SecaoDoEditor;
  indice: number;
  total: number;
  ocupado: boolean;
  agir: (o_que: () => Promise<unknown>) => Promise<boolean>;
  aoMover: (passo: number) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [titulo, setTitulo] = useState(secao.title);
  const [emoji, setEmoji] = useState(secao.emoji);
  const [prazo, setPrazo] = useState(secao.sla_text ?? "");

  const perguntas = ordenadasPorPosicao(secao.questions);

  async function excluir() {
    const ok = window.confirm(
      `Excluir a seção “${secao.title}”?\n\n` +
        (perguntas.length > 0
          ? `As ${perguntas.length} perguntas dela vão junto.\n\n`
          : "") +
        "Os pedidos que já chegaram por esta seção NÃO são apagados — eles " +
        "continuam na fila com as respostas que foram dadas."
    );
    if (!ok) return;
    await agir(() => apagarSecao(secao.id));
  }

  return (
    <section
      style={{
        border: "1px solid var(--border)",
        borderRadius: 12,
        background: "var(--surface)",
        marginBottom: 14,
        overflow: "hidden",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span aria-hidden style={{ fontSize: 18 }}>
          {secao.emoji || "•"}
        </span>
        <strong style={{ fontSize: 15 }}>{secao.title}</strong>
        <code className="muted" style={{ fontSize: 12 }}>
          {secao.slug}
        </code>
        {secao.sla_text && (
          <span className="muted" style={{ fontSize: 12 }}>
            {secao.sla_text}
          </span>
        )}

        <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <Seta
            direcao="cima"
            oque={`Subir a seção ${secao.title}`}
            desabilitado={ocupado || indice === 0}
            aoClicar={() => aoMover(-1)}
          />
          <Seta
            direcao="baixo"
            oque={`Descer a seção ${secao.title}`}
            desabilitado={ocupado || indice === total - 1}
            aoClicar={() => aoMover(1)}
          />
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 12 }}
            disabled={ocupado}
            onClick={() => setEditando((v) => !v)}
          >
            {editando ? "Fechar" : "Editar"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 12, color: "var(--danger)" }}
            disabled={ocupado}
            onClick={excluir}
          >
            Excluir
          </button>
        </span>
      </header>

      {editando && (
        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
            background: "var(--edicao-fundo)",
          }}
        >
          <div className="field" style={{ flex: "1 1 220px" }}>
            <label className="label" htmlFor={`t-${secao.id}`}>
              Título
            </label>
            <input
              id={`t-${secao.id}`}
              className="input"
              value={titulo}
              maxLength={120}
              onChange={(e) => setTitulo(e.target.value)}
            />
          </div>
          <div className="field" style={{ flex: "0 0 90px" }}>
            <label className="label" htmlFor={`e-${secao.id}`}>
              Emoji
            </label>
            <input
              id={`e-${secao.id}`}
              className="input"
              value={emoji}
              maxLength={16}
              onChange={(e) => setEmoji(e.target.value)}
            />
          </div>
          <div className="field" style={{ flex: "1 1 180px" }}>
            <label className="label" htmlFor={`p-${secao.id}`}>
              Prazo mostrado
            </label>
            <input
              id={`p-${secao.id}`}
              className="input"
              placeholder="5 dias úteis"
              value={prazo}
              maxLength={200}
              onChange={(e) => setPrazo(e.target.value)}
            />
          </div>
          <div style={{ flex: "1 1 100%" }}>
            {/* ⚠️ O AVISO DO SLUG NÃO É DECORAÇÃO. Ele é o único campo da tela
                que não dá para mudar, e o motivo é invisível: ele viaja gravado
                em cada pedido, e é por ele que a fila descobre a categoria. */}
            <span className="muted" style={{ fontSize: 12 }}>
              O endereço <code>{secao.slug}</code> não muda — ele fica gravado
              em cada pedido que já chegou por esta seção, e é o que mantém eles
              legíveis na fila. Título e emoji podem mudar à vontade: eles valem
              também para o passado.
            </span>
          </div>
          <div style={{ flex: "1 1 100%", display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={ocupado || !titulo.trim()}
              onClick={async () => {
                // ⚠️ `sla_text` VAI COMO STRING VAZIA, e não como `null`. No
                // PATCH deste projeto `null` significa "não mexe" -- então
                // apagar o prazo era silenciosamente ignorado: 200 OK, nada
                // mudava, e o valor antigo voltava ao recarregar. Não havia
                // como limpar o campo pela tela. O backend já converte `""`
                // para `None` (`.strip() or None`).
                const ok = await agir(() =>
                  editarSecao(secao.id, {
                    title: titulo,
                    emoji,
                    sla_text: prazo.trim(),
                  })
                );
                // ⚠️ SÓ FECHA SE DEU CERTO -- senão o painel some levando o
                // que a pessoa digitou, e a mensagem de erro fica órfã.
                if (ok) setEditando(false);
              }}
            >
              Salvar seção
            </button>
          </div>
        </div>
      )}

      <div style={{ padding: "6px 16px 14px" }}>
        {perguntas.length === 0 && (
          <p className="muted" style={{ fontSize: 13 }}>
            Nenhuma pergunta nesta seção ainda.
          </p>
        )}
        {perguntas.map((q, i) => (
          <Pergunta
            key={q.id}
            secao={secao}
            pergunta={q}
            indice={i}
            total={perguntas.length}
            ehResumo={secao.summary_question_id === q.id}
            ehPadraoDeResumo={secao.summary_question_id === null && i === 0}
            ocupado={ocupado}
            agir={agir}
            aoMover={(passo) =>
              agir(() =>
                reordenarPerguntas(
                  secao.id,
                  movido(perguntas, i, passo).map((x) => x.id)
                )
              )
            }
          />
        ))}
        <NovaPergunta
          ocupado={ocupado}
          aoCriar={(entrada) => agir(() => criarPergunta(secao.id, entrada))}
        />
      </div>
    </section>
  );
}

// =====================================================================
// Pergunta
// =====================================================================
function Pergunta({
  secao,
  pergunta,
  indice,
  total,
  ehResumo,
  ehPadraoDeResumo,
  ocupado,
  agir,
  aoMover,
}: {
  secao: SecaoDoEditor;
  pergunta: PerguntaDoEditor;
  indice: number;
  total: number;
  ehResumo: boolean;
  ehPadraoDeResumo: boolean;
  ocupado: boolean;
  agir: (o_que: () => Promise<unknown>) => Promise<boolean>;
  aoMover: (passo: number) => void;
}) {
  const [aberta, setAberta] = useState(false);
  const avisar = useAvisar();

  const gatilho = pergunta.show_if_question_id
    ? secao.questions.find((q) => q.id === pergunta.show_if_question_id)
    : null;
  const dependentes = dependentesDe(secao, pergunta.id);
  const impedeSubir = impedimentoParaMover(secao, indice, -1);
  const impedeDescer = impedimentoParaMover(secao, indice, 1);

  async function excluir() {
    // ⚠️ O AVISO VEM ANTES DA RECUSA. O backend recusa de qualquer forma, mas
    // descobrir por uma caixa vermelha depois do clique é pior do que ler o
    // motivo antes.
    if (dependentes.length > 0) {
      avisar(
        `Não dá para excluir “${pergunta.label}”: ` +
          dependentes.map((d) => `“${d.label}”`).join(", ") +
          ` só aparece${dependentes.length === 1 ? "" : "m"} por causa dela. ` +
          "Tire a condição primeiro."
      );
      return;
    }
    if (!window.confirm(`Excluir a pergunta “${pergunta.label}”?`)) return;
    await agir(() => apagarPergunta(pergunta.id));
  }

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "8px 10px",
        marginBottom: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 14, minWidth: 0 }}>{pergunta.label}</span>
        <span className="muted" style={{ fontSize: 11.5 }}>
          {nomeDoTipo(pergunta.kind)}
        </span>
        {pergunta.required && (
          <span className="muted" style={{ fontSize: 11.5 }}>
            obrigatória
          </span>
        )}
        {gatilho && (
          <span
            className="muted"
            style={{ fontSize: 11.5 }}
            title={`Só aparece quando “${gatilho.label}” for “${pergunta.show_if_value}”`}
          >
            só se {gatilho.label} = {pergunta.show_if_value}
          </span>
        )}
        {(ehResumo || ehPadraoDeResumo) && (
          <span
            className="muted"
            style={{ fontSize: 11.5 }}
            title={
              ehResumo
                ? "É o título do pedido na fila."
                : "Sem escolha, a fila usa a primeira pergunta da seção."
            }
          >
            {ehResumo ? "título na fila" : "título na fila (padrão)"}
          </span>
        )}

        <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <Seta
            direcao="cima"
            oque={`Subir a pergunta ${pergunta.label}`}
            desabilitado={ocupado || indice === 0 || impedeSubir !== null}
            motivo={impedeSubir}
            aoClicar={() => aoMover(-1)}
          />
          <Seta
            direcao="baixo"
            oque={`Descer a pergunta ${pergunta.label}`}
            desabilitado={ocupado || indice === total - 1 || impedeDescer !== null}
            motivo={impedeDescer}
            aoClicar={() => aoMover(1)}
          />
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 12 }}
            disabled={ocupado}
            onClick={() => setAberta((v) => !v)}
          >
            {aberta ? "Fechar" : "Editar"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 12, color: "var(--danger)" }}
            disabled={ocupado}
            onClick={excluir}
          >
            Excluir
          </button>
        </span>
      </div>

      {aberta && (
        <FormPergunta
          secao={secao}
          pergunta={pergunta}
          ehResumo={ehResumo}
          ocupado={ocupado}
          agir={agir}
          aoFechar={() => setAberta(false)}
        />
      )}
    </div>
  );
}

function FormPergunta({
  secao,
  pergunta,
  ehResumo,
  ocupado,
  agir,
  aoFechar,
}: {
  secao: SecaoDoEditor;
  pergunta: PerguntaDoEditor;
  ehResumo: boolean;
  ocupado: boolean;
  agir: (o_que: () => Promise<unknown>) => Promise<boolean>;
  aoFechar: () => void;
}) {
  const [label, setLabel] = useState(pergunta.label);
  const [kind, setKind] = useState(pergunta.kind);
  const [obrigatoria, setObrigatoria] = useState(pergunta.required);
  const [opcoes, setOpcoes] = useState(pergunta.options.join("\n"));
  const [ajuda, setAjuda] = useState(pergunta.help ?? "");
  const [alvo, setAlvo] = useState(pergunta.show_if_question_id ?? "");
  const [valor, setValor] = useState(pergunta.show_if_value ?? "");

  const alvos = alvosPossiveis(secao, pergunta);
  const opcoesDoAlvo = alvos.find((a) => a.id === alvo)?.options ?? [];

  async function salvar() {
    const ok = await agir(async () => {
      await editarPergunta(pergunta.id, {
        label,
        kind,
        required: obrigatoria,
        // ⚠️ SÓ MANDA `options` QUANDO O TIPO USA. Mandar `[]` para um `texto`
        // é inofensivo, mas mandar `[]` por engano para uma `escolha` apagaria
        // as alternativas -- e o backend não tem como distinguir "esvazie" de
        // "não mexa" se o campo sempre vier.
        ...(exigeOpcoes(kind)
          ? { options: opcoes.split("\n").map((o) => o.trim()).filter(Boolean) }
          : {}),
        // ⚠️ STRING VAZIA, e não `null`: `null` no PATCH é "não mexe", e
        // apagar a ajuda era ignorado em silêncio. Mesmo caso do `sla_text`
        // da seção. O backend converte `""` para `None`.
        help: ajuda.trim(),
      });
      // ⚠️ A CONDICIONAL É UMA SEGUNDA CHAMADA porque é uma rota própria: nela
      // `null` significa DESLIGAR, e num PATCH significaria "não mexa".
      const alvoAtual = pergunta.show_if_question_id ?? "";
      const valorAtual = pergunta.show_if_value ?? "";
      if (alvo !== alvoAtual || valor !== valorAtual) {
        await definirCondicional(pergunta.id, alvo || null, alvo ? valor : null);
      }
    });
    // ⚠️ SÓ FECHA SE DEU CERTO. O editor tem oito códigos de recusa, e cada
    // um fechava o painel levando o que a pessoa tinha digitado.
    if (ok) aoFechar();
  }

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        marginTop: 10,
        paddingTop: 10,
        borderTop: "1px solid var(--border)",
      }}
    >
      <div className="field" style={{ flex: "1 1 260px" }}>
        <label className="label" htmlFor={`l-${pergunta.id}`}>
          Pergunta
        </label>
        <input
          id={`l-${pergunta.id}`}
          className="input"
          value={label}
          maxLength={300}
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>

      <div className="field" style={{ flex: "0 1 170px" }}>
        <label className="label" htmlFor={`k-${pergunta.id}`}>
          Tipo
        </label>
        <select
          id={`k-${pergunta.id}`}
          className="input"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          {TIPOS_DE_PERGUNTA.map((t) => (
            <option key={t.kind} value={t.kind}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field" style={{ flex: "0 1 150px", justifyContent: "flex-end" }}>
        <label className="label" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={obrigatoria}
            onChange={(e) => setObrigatoria(e.target.checked)}
          />
          Obrigatória
        </label>
      </div>

      {exigeOpcoes(kind) && (
        <div className="field" style={{ flex: "1 1 100%" }}>
          <label className="label" htmlFor={`o-${pergunta.id}`}>
            Alternativas — uma por linha
          </label>
          <textarea
            id={`o-${pergunta.id}`}
            className="input"
            rows={Math.max(3, opcoes.split("\n").length)}
            value={opcoes}
            onChange={(e) => setOpcoes(e.target.value)}
          />
        </div>
      )}

      <div className="field" style={{ flex: "1 1 100%" }}>
        <label className="label" htmlFor={`a-${pergunta.id}`}>
          Ajuda (aparece abaixo da pergunta)
        </label>
        <input
          id={`a-${pergunta.id}`}
          className="input"
          value={ajuda}
          maxLength={300}
          onChange={(e) => setAjuda(e.target.value)}
        />
      </div>

      {/* ⚠️ A CONDICIONAL SÓ APARECE QUANDO HÁ ALVO POSSÍVEL. Um `<select>`
          vazio com o rótulo "só aparece quando" faria procurar uma opção que
          não existe -- e a razão de não existir (precisa de uma pergunta de
          escolha ANTES desta) fica escrita no lugar. */}
      <div className="field" style={{ flex: "1 1 100%" }}>
        <span className="label">Só aparece quando…</span>
        {alvos.length === 0 ? (
          <span className="muted" style={{ fontSize: 12 }}>
            Para condicionar esta pergunta, é preciso uma pergunta de escolha
            <strong> antes </strong> dela, nesta mesma seção.
          </span>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select
              className="input"
              aria-label="Pergunta que comanda"
              style={{ flex: "1 1 220px" }}
              value={alvo}
              onChange={(e) => {
                setAlvo(e.target.value);
                setValor("");
              }}
            >
              <option value="">Sempre aparece</option>
              {alvos.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
            {alvo && (
              <select
                className="input"
                aria-label="Alternativa que faz aparecer"
                style={{ flex: "1 1 200px" }}
                value={valor}
                onChange={(e) => setValor(e.target.value)}
              >
                <option value="">Escolha a alternativa…</option>
                {opcoesDoAlvo.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      <div
        style={{
          flex: "1 1 100%",
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
        }}
      >
        <button
          type="button"
          className="btn btn-ghost"
          style={{ marginRight: "auto", fontSize: 12 }}
          disabled={ocupado}
          onClick={() =>
            agir(() => definirResumo(secao.id, ehResumo ? null : pergunta.id))
          }
          title="A resposta desta pergunta vira o título do pedido na fila."
        >
          {ehResumo ? "Deixar de ser o título na fila" : "Usar como título na fila"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={aoFechar}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={ocupado || !label.trim() || (!!alvo && !valor)}
          onClick={salvar}
        >
          Salvar pergunta
        </button>
      </div>
    </div>
  );
}

// =====================================================================
// Criar
// =====================================================================
function NovaSecao({
  ocupado,
  aoCriar,
}: {
  ocupado: boolean;
  aoCriar: (entrada: { slug: string; title: string; emoji: string }) => Promise<boolean>;
}) {
  const [abrindo, setAbrindo] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [slug, setSlug] = useState("");
  const [emoji, setEmoji] = useState("");
  const [mexeuNoSlug, setMexeuNoSlug] = useState(false);

  if (!abrindo) {
    return (
      <button
        type="button"
        className="btn btn-ghost"
        disabled={ocupado}
        onClick={() => setAbrindo(true)}
      >
        + Nova seção
      </button>
    );
  }

  return (
    <div
      style={{
        border: "1px dashed var(--border)",
        borderRadius: 12,
        padding: 14,
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
      }}
    >
      <div className="field" style={{ flex: "1 1 240px" }}>
        <label className="label" htmlFor="nova-secao-titulo">
          Título da seção
        </label>
        <input
          id="nova-secao-titulo"
          className="input"
          autoFocus
          placeholder="Ex.: Criar uma arte"
          value={titulo}
          maxLength={120}
          onChange={(e) => {
            setTitulo(e.target.value);
            // ⚠️ A SUGESTÃO PARA DE SEGUIR ASSIM QUE ALGUÉM MEXE NO SLUG. Ele é
            // permanente; sobrescrever o que a pessoa digitou seria trocar,
            // sem aviso, um valor que não tem volta.
            if (!mexeuNoSlug) setSlug(sugereSlugDeSecao(e.target.value));
          }}
        />
      </div>
      <div className="field" style={{ flex: "0 0 90px" }}>
        <label className="label" htmlFor="nova-secao-emoji">
          Emoji
        </label>
        <input
          id="nova-secao-emoji"
          className="input"
          value={emoji}
          maxLength={16}
          onChange={(e) => setEmoji(e.target.value)}
        />
      </div>
      <div className="field" style={{ flex: "1 1 200px" }}>
        <label className="label" htmlFor="nova-secao-slug">
          Endereço interno
        </label>
        <input
          id="nova-secao-slug"
          className="input"
          value={slug}
          maxLength={60}
          onChange={(e) => {
            setMexeuNoSlug(true);
            setSlug(e.target.value);
          }}
        />
        <span className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          Fica gravado em cada pedido desta seção. <strong>Não muda depois.</strong>
        </span>
      </div>
      <div style={{ flex: "1 1 100%", display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setAbrindo(false)}
        >
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={ocupado || !titulo.trim() || !slug.trim()}
          onClick={async () => {
            const ok = await aoCriar({
              slug: slug.trim(),
              title: titulo.trim(),
              emoji,
            });
            // ⚠️ SÓ LIMPA SE DEU CERTO. Slug repetido é a recusa mais comum
            // aqui, e ela apagava o título inteiro que a pessoa acabara de
            // escrever -- junto com o slug que ela precisava trocar.
            if (!ok) return;
            setTitulo("");
            setSlug("");
            setEmoji("");
            setMexeuNoSlug(false);
            setAbrindo(false);
          }}
        >
          Criar seção
        </button>
      </div>
    </div>
  );
}

function NovaPergunta({
  ocupado,
  aoCriar,
}: {
  ocupado: boolean;
  aoCriar: (entrada: {
    label: string;
    kind: string;
    required: boolean;
    options: string[];
  }) => Promise<boolean>;
}) {
  const [abrindo, setAbrindo] = useState(false);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState("texto");
  const [obrigatoria, setObrigatoria] = useState(false);
  const [opcoes, setOpcoes] = useState("");

  if (!abrindo) {
    return (
      <button
        type="button"
        className="btn btn-ghost"
        style={{ fontSize: 12 }}
        disabled={ocupado}
        onClick={() => setAbrindo(true)}
      >
        + Nova pergunta
      </button>
    );
  }

  const lista = opcoes.split("\n").map((o) => o.trim()).filter(Boolean);

  return (
    <div
      style={{
        border: "1px dashed var(--border)",
        borderRadius: 10,
        padding: 10,
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
      }}
    >
      <div className="field" style={{ flex: "1 1 240px" }}>
        <label className="label" htmlFor="nova-pergunta-label">
          Pergunta
        </label>
        <input
          id="nova-pergunta-label"
          className="input"
          autoFocus
          placeholder="Ex.: O que você precisa?"
          value={label}
          maxLength={300}
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>
      <div className="field" style={{ flex: "0 1 170px" }}>
        <label className="label" htmlFor="nova-pergunta-tipo">
          Tipo
        </label>
        <select
          id="nova-pergunta-tipo"
          className="input"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          {TIPOS_DE_PERGUNTA.map((t) => (
            <option key={t.kind} value={t.kind}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field" style={{ flex: "0 1 140px", justifyContent: "flex-end" }}>
        <label className="label" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={obrigatoria}
            onChange={(e) => setObrigatoria(e.target.checked)}
          />
          Obrigatória
        </label>
      </div>
      {exigeOpcoes(kind) && (
        <div className="field" style={{ flex: "1 1 100%" }}>
          <label className="label" htmlFor="nova-pergunta-opcoes">
            Alternativas — uma por linha
          </label>
          <textarea
            id="nova-pergunta-opcoes"
            className="input"
            rows={3}
            value={opcoes}
            onChange={(e) => setOpcoes(e.target.value)}
          />
          {/* ⚠️ SEM ALTERNATIVA, UMA PERGUNTA DE ESCOLHA É UM BECO: aparece com
              zero opções e, se for obrigatória, TRAVA o envio de quem responde
              -- sem que a pessoa tenha como saber por quê. */}
          {lista.length === 0 && (
            <span className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Uma pergunta de escolha precisa de ao menos uma alternativa.
            </span>
          )}
        </div>
      )}
      <div style={{ flex: "1 1 100%", display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="btn btn-ghost" onClick={() => setAbrindo(false)}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={
            ocupado || !label.trim() || (exigeOpcoes(kind) && lista.length === 0)
          }
          onClick={async () => {
            const ok = await aoCriar({
              label: label.trim(),
              kind,
              required: obrigatoria,
              options: lista,
            });
            // ⚠️ IDEM. Uma pergunta de escolha com seis alternativas digitadas
            // à mão sumia inteira num 422.
            if (!ok) return;
            setLabel("");
            setOpcoes("");
            setObrigatoria(false);
            setAbrindo(false);
          }}
        >
          Criar pergunta
        </button>
      </div>
    </div>
  );
}

/**
 * ⚠️ A SETA CARREGA O MOTIVO DE ESTAR DESABILITADA.
 *
 * Um botão cinza sem explicação é a pior versão de uma regra: ela existe, ela
 * impede, e ninguém sabe por quê. O `title` diz qual condicional quebraria.
 */
function Seta({
  direcao,
  oque,
  desabilitado,
  motivo,
  aoClicar,
}: {
  direcao: "cima" | "baixo";
  oque: string;
  desabilitado: boolean;
  motivo?: string | null;
  aoClicar: () => void;
}) {
  return (
    <button
      type="button"
      className="btn btn-ghost"
      style={{ fontSize: 12, padding: "2px 8px" }}
      aria-label={oque}
      title={motivo ?? oque}
      disabled={desabilitado}
      onClick={aoClicar}
    >
      {direcao === "cima" ? "↑" : "↓"}
    </button>
  );
}
