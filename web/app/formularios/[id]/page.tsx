"use client";
// /formularios/[id]: o editor de seções e perguntas.
//
// Ordem por setas, não por arrastar: `onDragEnd` não roda em jsdom, e as setas
// são testáveis, funcionam no teclado e desabilitam com o motivo quando o
// movimento quebraria uma condicional.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import EmptyState from "@/components/EmptyState";
import { useFaixaDeTela } from "@/lib/useFaixaDeTela";

import AppShell from "@/components/AppShell";
import Badge from "@/components/Badge";
import PageHeader from "@/components/PageHeader";
import Loading from "@/components/Loading";
import { useAvisar } from "@/components/Toasts";
import { withTeam } from "@/lib/activeTeam";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
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
  listarFormularios,
  obterFormulario,
  publicarFormulario,
  renomearFormulario,
  reordenarPerguntas,
  reordenarSecoes,
  type Formulario,
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
      <EditorOuAviso />
    </AppShell>
  );
}

// Montar formulário é só em tela grande.
function EditorOuAviso() {
  // Decide uma vez, ao abrir: cruzar 768 px no meio da edição desmontaria o
  // editor e perderia o rascunho.
  const [faixaAoAbrir] = useState(useFaixaDeTela());
  if (faixaAoAbrir !== "celular") return <Editor />;
  return (
    <EmptyState
      title="Abra no computador"
      description="Editar um formulário precisa de uma tela maior. Abra no computador ou no tablet."
      action={
        <Link href="/formularios" className="btn btn-ghost">
          Voltar aos formulários
        </Link>
      }
    />
  );
}

function Editor() {
  const params = useParams<{ id: string }>();
  const formId = params?.id ?? "";

  const [form, setForm] = useState<FormularioDetalhado | null>(null);
  useDocumentTitle(form?.title);
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

  // Os outros formulários do mesmo time, numa coluna à esquerda. Acessório: se
  // a lista falhar, a coluna fica só com este.
  const [lista, setLista] = useState<Formulario[]>([]);
  const teamId = form?.team_id ?? null;
  useEffect(() => {
    if (!teamId) return;
    let vivo = true;
    listarFormularios(teamId)
      .then((fs) => vivo && Array.isArray(fs) && setLista(fs))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [teamId]);

  /**
   * Toda escrita passa por aqui e recarrega o formulário inteiro: quase toda
   * ação mexe em mais de uma coisa, e costurar no estado local duplicaria as
   * regras do backend.
   */
  async function agir(o_que: () => Promise<unknown>): Promise<boolean> {
    setOcupado(true);
    setErro(null);
    try {
      await o_que();
      await recarregar();
      return true;
    } catch (e) {
      // A mensagem do backend aparece inteira: ela nomeia a pergunta que travou.
      setErro((e as ApiError).message || "Não consegui salvar.");
      // Devolve `false` para o chamador não limpar os campos nem fechar o painel.
      return false;
    } finally {
      setOcupado(false);
    }
  }

  if (fatal) {
    return (
      <div>
        {/* Caminho puro: o formulário não carregou, então não há time dele para levar. */}
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

  const vizinhos = lista.length > 0 ? lista : [form];

  return (
    <div className="grid items-start gap-5 md:grid-cols-[340px_minmax(0,1fr)]">
      {/* ---- a coluna dos formulários do time ---- */}
      <aside className="flex flex-col gap-2" aria-label="Formulários do time">
        {/* Leva o time do formulário: esta rota não tem `?time=`, e o caminho puro
            faria a lista cair noutro time. */}
        <Link
          href={withTeam("/formularios", "", form.team_id)}
          className="muted mb-1"
          style={{ fontSize: 13 }}
        >
          ‹ Formulários
        </Link>
        {vizinhos.map((f) => {
          const atual = f.id === form.id;
          return (
            <Link
              key={f.id}
              href={`/formularios/${f.id}`}
              aria-current={atual ? "page" : undefined}
              className={`flex flex-col gap-1.5 rounded-xl border bg-surface p-3.5 text-ink no-underline transition-[border-color,box-shadow] duration-200 hover:border-accent ${
                atual ? "border-accent shadow-[0_0_0_3px_var(--accent-soft)]" : "border-border"
              }`}
            >
              <span className="flex items-center gap-2">
                <strong className="min-w-0 flex-1 truncate text-base">{f.title}</strong>
                {f.is_published ? (
                  <Badge tone="soft" size="sm" color="var(--teal)" className="shrink-0">Publicado</Badge>
                ) : (
                  <Badge tone="neutral" size="sm" weight="semibold" className="shrink-0 bg-surface-2 text-ink-soft">Rascunho</Badge>
                )}
              </span>
              <code className="muted truncate text-xs">/solicitar/{f.slug}</code>
            </Link>
          );
        })}
      </aside>

      <div className="min-w-0">
      <PageHeader
        title={form.title}
        count={`${total} ${total === 1 ? "pergunta" : "perguntas"} em ${
          secoes.length
        } ${secoes.length === 1 ? "seção" : "seções"}`}
        actions={
          <>
            {/* A porta pública, só se publicado (rascunho responde 404). */}
            {form.is_published && (
              <a
                className="btn"
                href={`/solicitar/${form.slug}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Abrir formulário ↗
              </a>
            )}
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
          </>
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
    </div>
  );
}

// =====================================================================
// O cabeçalho: o que a porta pública mostra antes das perguntas
// =====================================================================
/** Título do formulário e os campos de identificação que ele pede. */
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
        {/* O resumo lê o `form`, não o estado local: diz o que está no banco. */}
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
        {/* Nome e e-mail aparecem desligados e explicados, em vez de sumirem. */}
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
          // Cancelar desfaz o estado local, não só fecha: senão o resumo mentiria
          // e o próximo salvar reenviaria `polo_label: null` (que é "desligue").
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
              // Os três rótulos vão sempre: para eles `null` significa desligue,
              // e o backend distingue "não veio" de "veio null".
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
  const [repetivel, setRepetivel] = useState(secao.repeatable ?? false);
  const [rotuloRepeticao, setRotuloRepeticao] = useState(secao.repeat_label ?? "");

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
        {secao.repeatable && (
          <span className="muted" style={{ fontSize: 12 }}>
            · repete até 20×
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
          {/* Seção repetível: cada repetição no mesmo envio vira um pedido na fila. */}
          <div
            style={{ flex: "1 1 100%", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}
          >
            <label
              style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, flex: "1 1 260px" }}
            >
              <input
                type="checkbox"
                checked={repetivel}
                onChange={(e) => setRepetivel(e.target.checked)}
              />
              Pode ser preenchida mais de uma vez no mesmo envio (até 20)
            </label>
            {repetivel && (
              <div className="field" style={{ flex: "1 1 220px" }}>
                <label className="label" htmlFor={`r-${secao.id}`}>
                  Cada repetição se chama
                </label>
                <input
                  id={`r-${secao.id}`}
                  className="input"
                  placeholder={secao.title.toLowerCase()}
                  value={rotuloRepeticao}
                  maxLength={60}
                  onChange={(e) => setRotuloRepeticao(e.target.value)}
                />
                <span className="muted" style={{ fontSize: 12 }}>
                  O botão fica “+ Adicionar outro {(rotuloRepeticao.trim() || secao.title).toLowerCase()}”.
                </span>
              </div>
            )}
          </div>
          <div style={{ flex: "1 1 100%" }}>
            {/* O slug não muda: viaja gravado em cada pedido e é por ele que a fila descobre a categoria. */}
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
                // `sla_text` vai como string vazia, não `null`: no PATCH `null` é
                // "não mexe". O backend converte `""` para `None`.
                const ok = await agir(() =>
                  editarSecao(secao.id, {
                    title: titulo,
                    emoji,
                    sla_text: prazo.trim(),
                    repeatable: repetivel,
                    // String vazia limpa (volta ao título), como o prazo.
                    repeat_label: rotuloRepeticao.trim(),
                  })
                );
                // Só fecha se deu certo, senão o painel some com o que foi digitado.
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
    // O aviso vem antes da recusa do backend.
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
        // Só manda `options` quando o tipo usa: `[]` por engano numa `escolha`
        // apagaria as alternativas.
        ...(exigeOpcoes(kind)
          ? { options: opcoes.split("\n").map((o) => o.trim()).filter(Boolean) }
          : {}),
        // String vazia, não `null`: no PATCH `null` é "não mexe". O backend converte `""` para `None`.
        help: ajuda.trim(),
      });
      // A condicional é rota própria: nela `null` significa desligar; num PATCH, "não mexa".
      const alvoAtual = pergunta.show_if_question_id ?? "";
      const valorAtual = pergunta.show_if_value ?? "";
      if (alvo !== alvoAtual || valor !== valorAtual) {
        await definirCondicional(pergunta.id, alvo || null, alvo ? valor : null);
      }
    });
    // Só fecha se deu certo, senão o painel some com o que foi digitado.
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

      {/* A condicional só aparece quando há alvo possível; senão, o motivo fica escrito. */}
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
            // A sugestão para de seguir quando alguém mexe no slug: ele é permanente.
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
            // Só limpa se deu certo: slug repetido é a recusa mais comum.
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
          {/* Escolha sem alternativa, se obrigatória, trava o envio de quem responde. */}
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
            // Idem: um 422 apagaria as alternativas digitadas.
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

/** Seta de ordem; o `title` diz por que está desabilitada (qual condicional quebraria). */
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
