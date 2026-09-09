"use client";
// app/times/page.tsx
// Tela de gestao de times (Spec 029, Fatia 4).
//
// Rota PROPRIA: gerir organograma e cadastrar
// pessoa sao coisas diferentes, e foi essa separacao que manteve a Spec 028
// (membros) e esta (times) com escopos tratáveis.
//
// O que esta tela NAO faz:
//   - mover subtime (D7). A rota existe no backend, sem botao: hoje ha uma
//     raiz e nove irmaos, e mover so criaria o segundo nivel de hierarquia
//     que ninguem tem.
//   - esvaziar time cheio. Isso e a Fatia 3; aqui o time cheio so informa o
//     que precisa sair antes.
//
// Toda decisao (pode editar? pode remover? por que nao? o texto digitado
// confirma?) vive em `lib/gestaoTimes.ts`, testada. Aqui so desenha.

import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import { useFecharAoClicarFora } from "@/lib/useCliqueFora";
import {
  ApiError,
  createTeam,
  currentUser,
  deleteTeam,
  esvaziarERemoverTeam,
  listTeamsAll,
  previaRemocaoTeam,
  updateTeam,
  type CurrentUser,
  type PreviaRemocao,
  type Team,
} from "@/lib/api";
import {
  confirmacaoValida,
  descreveConteudo,
  ehRaiz,
  motivoNaoRemove,
  ordenaParaTela,
  podeEditar,
  podeEsvaziarERemover,
  podeRemover,
  resumoDoEsvaziamento,
  sugereSlug,
} from "@/lib/gestaoTimes";

// O backend manda as contagens sempre; o tipo as traz opcionais porque
// `Team` tambem circula em respostas de mutacao, que nao as incluem.
function contagens(t: Team) {
  return {
    tarefas: t.tarefas ?? 0,
    projetos: t.projetos ?? 0,
    membros: t.membros ?? 0,
    filhos: t.filhos ?? 0,
  };
}

export default function TimesPage() {
  const [times, setTimes] = useState<Team[] | null>(null);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // criar
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTocado, setSlugTocado] = useState(false);
  const [erroCriar, setErroCriar] = useState<string | null>(null);
  const [salvandoCriar, setSalvandoCriar] = useState(false);

  // editar
  const [editando, setEditando] = useState<Team | null>(null);
  const [nomeEdit, setNomeEdit] = useState("");
  const [descEdit, setDescEdit] = useState("");
  const [erroEdit, setErroEdit] = useState<string | null>(null);
  const [salvandoEdit, setSalvandoEdit] = useState(false);

  // remover
  const [removendo, setRemovendo] = useState<Team | null>(null);
  const [confirmacao, setConfirmacao] = useState("");
  const [erroRemover, setErroRemover] = useState<string | null>(null);
  const [salvandoRemover, setSalvandoRemover] = useState(false);
  // Previa vinda do BACKEND, buscada ao abrir o dialogo. Nao reaproveitamos
  // as contagens da listagem: elas envelhecem, e aqui o numero vai virar uma
  // promessa escrita na tela.
  const [previa, setPrevia] = useState<PreviaRemocao | null>(null);
  const [carregandoPrevia, setCarregandoPrevia] = useState(false);

  const permissoes = me?.permissions ?? [];
  const raiz = times?.find(ehRaiz) ?? null;

  async function carregar() {
    try {
      setTimes(await listTeamsAll());
    } catch (e) {
      setErro((e as ApiError).message || "Não consegui carregar os times.");
    }
  }

  useEffect(() => {
    carregar();
    currentUser().then(setMe).catch(() => {});
  }, []);

  // --- criar ---------------------------------------------------------
  function abrirCriar() {
    setNome("");
    setSlug("");
    setSlugTocado(false);
    setErroCriar(null);
    setCriando(true);
  }

  function mudarNome(v: string) {
    setNome(v);
    // Sugere o slug enquanto a pessoa nao o editar a mao. Sem isso, digitar
    // "CRM e Automação" devolveria 422 e ela teria que adivinhar a regra.
    if (!slugTocado) setSlug(sugereSlug(v));
  }

  async function salvarCriar() {
    if (!raiz) return;
    const n = nome.trim();
    const s = slug.trim();
    if (!n || !s) {
      setErroCriar("Nome e identificador são obrigatórios.");
      return;
    }
    setSalvandoCriar(true);
    setErroCriar(null);
    try {
      await createTeam({ name: n, slug: s, parent_team_id: raiz.id });
      setCriando(false);
      await carregar();
    } catch (e) {
      const err = e as ApiError;
      setErroCriar(
        err.status === 403
          ? "Você não tem permissão para criar times."
          : err.status === 409
          ? "Já existe um time com esse identificador."
          : err.status === 422
          ? "Identificador inválido: use só letras minúsculas, números e hífen."
          : err.message || "Não consegui criar o time."
      );
    } finally {
      setSalvandoCriar(false);
    }
  }

  // --- editar --------------------------------------------------------
  function abrirEditar(t: Team) {
    setEditando(t);
    setNomeEdit(t.name);
    setDescEdit(t.description ?? "");
    setErroEdit(null);
  }

  async function salvarEditar() {
    if (!editando) return;
    const n = nomeEdit.trim();
    if (!n) {
      setErroEdit("O nome é obrigatório.");
      return;
    }
    setSalvandoEdit(true);
    setErroEdit(null);
    try {
      await updateTeam(editando.id, { name: n, description: descEdit });
      setEditando(null);
      await carregar();
    } catch (e) {
      const err = e as ApiError;
      setErroEdit(
        err.status === 403
          ? "Você não tem permissão para editar times."
          : err.status === 409
          ? "O time principal não pode ser editado."
          : err.message || "Não consegui salvar."
      );
    } finally {
      setSalvandoEdit(false);
    }
  }

  // --- remover -------------------------------------------------------
  function abrirRemover(t: Team) {
    setRemovendo(t);
    setConfirmacao("");
    setErroRemover(null);
    setPrevia(null);
    const c = contagens(t);
    // Time vazio nao precisa de previa -- nao ha nada a listar.
    if (c.tarefas || c.projetos || c.membros) {
      setCarregandoPrevia(true);
      previaRemocaoTeam(t.id)
        .then(setPrevia)
        .catch(() => setPrevia(null))
        .finally(() => setCarregandoPrevia(false));
    }
  }

  async function salvarRemover() {
    if (!removendo) return;
    // Trava de UI; o backend recheca tudo de qualquer forma.
    if (!confirmacaoValida(confirmacao, removendo.name)) return;
    setSalvandoRemover(true);
    setErroRemover(null);
    try {
      // Vazio -> DELETE simples. Com conteudo -> esvazia e remove numa
      // transacao. A tela escolhe a rota; o backend valida os dois casos.
      const c = contagens(removendo);
      if (c.tarefas || c.projetos || c.membros) {
        await esvaziarERemoverTeam(removendo.id);
      } else {
        await deleteTeam(removendo.id);
      }
      setRemovendo(null);
      await carregar();
    } catch (e) {
      const err = e as ApiError;
      // O 409 do backend ja vem com os numeros ("3 tarefas, 2 membros") --
      // e ele e a fonte da verdade: a contagem da tela pode ter envelhecido
      // desde o carregamento.
      setErroRemover(
        err.status === 403
          ? "So um administrador pode remover times."
          : err.status === 404
          ? "Este time não existe mais. Atualize a página."
          : err.message || "Não consegui remover o time."
      );
      await carregar();
    } finally {
      setSalvandoRemover(false);
    }
  }

  const listaOrdenada = times ? ordenaParaTela(times) : [];

  return (
    <AppShell>
      <PageHeader
        title="Times"
        count={times ? `${listaOrdenada.filter((t) => !ehRaiz(t)).length} subtimes` : null}
        actions={
          raiz && permissoes.includes("team.manage") ? (
            <button className="btn btn-primary" onClick={abrirCriar}>
              <Plus size={16} /> Novo subtime
            </button>
          ) : null
        }
      />

      {erro && <div className="error-box">{erro}</div>}

      {times === null ? (
        <div className="muted">Carregando…</div>
      ) : (
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          {listaOrdenada.map((t, i) => {
            const c = contagens(t);
            const alvo = { ...t, ...c };
            const raizItem = ehRaiz(t);
            const bloqueio = motivoNaoRemove(alvo, permissoes);
            const resumo = descreveConteudo(c);
            return (
              <div
                key={t.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 16px",
                  borderTop: i === 0 ? "none" : "1px solid var(--border)",
                  background: raizItem ? "var(--surface-2)" : undefined,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: raizItem ? 700 : 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {t.name}
                    {raizItem && (
                      <span
                        className="muted"
                        style={{ fontSize: 11, fontWeight: 500, marginLeft: 8 }}
                      >
                        time principal
                      </span>
                    )}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {t.slug}
                    {resumo && ` · ${resumo}`}
                  </div>
                </div>

                {podeEditar(t, permissoes) && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => abrirEditar(t)}
                    aria-label={`Editar ${t.name}`}
                    title="Editar"
                    style={{ padding: "6px 10px" }}
                  >
                    <Pencil size={15} />
                  </button>
                )}

                {/* Raiz nao mostra botao nenhum (D5). Nos demais, o botao
                    aparece sempre -- desabilitado com o motivo visivel, para
                    a pessoa entender ANTES de clicar em vez de descobrir
                    pelo erro. */}
                {!raizItem && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => abrirRemover(t)}
                    disabled={!podeEsvaziarERemover(alvo, permissoes)}
                    aria-label={`Remover ${t.name}`}
                    title={bloqueio ?? "Remover"}
                    style={{
                      padding: "6px 10px",
                      opacity: podeEsvaziarERemover(alvo, permissoes) ? 1 : 0.4,
                      cursor: podeEsvaziarERemover(alvo, permissoes)
                        ? "pointer"
                        : "not-allowed",
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ---- criar ---- */}
      {criando && (
        <Dialogo titulo="Novo subtime" onFechar={() => setCriando(false)}>
          {erroCriar && <div className="error-box">{erroCriar}</div>}
          <div className="field">
            <label className="label" htmlFor="t-nome">
              Nome
            </label>
            <input
              id="t-nome"
              className="input"
              value={nome}
              autoFocus
              maxLength={255}
              placeholder="Ex.: Influenciadores"
              onChange={(e) => mudarNome(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="t-slug">
              Identificador{" "}
              <span className="muted" style={{ fontWeight: 400 }}>
                (não muda depois)
              </span>
            </label>
            <input
              id="t-slug"
              className="input"
              value={slug}
              maxLength={120}
              onChange={(e) => {
                setSlugTocado(true);
                setSlug(e.target.value);
              }}
            />
          </div>
          <Rodape
            onCancelar={() => setCriando(false)}
            onConfirmar={salvarCriar}
            salvando={salvandoCriar}
            rotulo="Criar"
          />
        </Dialogo>
      )}

      {/* ---- editar ---- */}
      {editando && (
        <Dialogo titulo={`Editar ${editando.name}`} onFechar={() => setEditando(null)}>
          {erroEdit && <div className="error-box">{erroEdit}</div>}
          <div className="field">
            <label className="label" htmlFor="t-nome-e">
              Nome
            </label>
            <input
              id="t-nome-e"
              className="input"
              value={nomeEdit}
              autoFocus
              maxLength={255}
              onChange={(e) => setNomeEdit(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="t-desc-e">
              Descrição{" "}
              <span className="muted" style={{ fontWeight: 400 }}>
                (opcional)
              </span>
            </label>
            <textarea
              id="t-desc-e"
              className="input"
              rows={3}
              value={descEdit}
              style={{ resize: "vertical", fontFamily: "inherit" }}
              onChange={(e) => setDescEdit(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="t-slug-e">
              Identificador
            </label>
            <input
              id="t-slug-e"
              className="input"
              value={editando.slug}
              disabled
              title="O identificador e fixo: outras partes do sistema apontam para ele."
            />
          </div>
          <Rodape
            onCancelar={() => setEditando(null)}
            onConfirmar={salvarEditar}
            salvando={salvandoEdit}
            rotulo="Salvar"
          />
        </Dialogo>
      )}

      {/* ---- remover ---- */}
      {removendo && (
        <Dialogo titulo={`Remover ${removendo.name}`} onFechar={() => setRemovendo(null)}>
          {erroRemover && <div className="error-box">{erroRemover}</div>}

          {carregandoPrevia && <div className="muted">Conferindo o conteúdo…</div>}

          {previa && resumoDoEsvaziamento(previa).length > 0 && (
            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "10px 12px",
                fontSize: 13,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 6 }}>
                O que acontece com o conteúdo:
              </div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {resumoDoEsvaziamento(previa).map((linha) => (
                  <li key={linha} style={{ marginBottom: 2 }}>
                    {linha}
                  </li>
                ))}
              </ul>
              <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                Nada é apagado. As tarefas arquivadas ficam em Arquivadas e
                podem voltar a qualquer momento.
              </div>
            </div>
          )}

          <p style={{ margin: 0, fontSize: 14 }}>
            O time será removido. Para confirmar, digite{" "}
            <strong>{removendo.name}</strong> abaixo.
          </p>
          <input
            className="input"
            value={confirmacao}
            autoFocus
            placeholder={removendo.name}
            onChange={(e) => setConfirmacao(e.target.value)}
          />
          <Rodape
            onCancelar={() => setRemovendo(null)}
            onConfirmar={salvarRemover}
            salvando={salvandoRemover}
            rotulo="Remover"
            perigo
            desabilitado={!confirmacaoValida(confirmacao, removendo.name)}
          />
        </Dialogo>
      )}
    </AppShell>
  );
}

// --------------------------------------------------------------------
// Casca de dialogo. Sem <form>: os campos aqui sao poucos e o Enter num
// input dispararia submit implicito -- foi exatamente esse comportamento
// que criou tarefa sem responsavel no TaskModal.
// --------------------------------------------------------------------
function Dialogo({
  titulo,
  onFechar,
  children,
}: {
  titulo: string;
  onFechar: () => void;
  children: React.ReactNode;
}) {
  // Mesmo defeito dos outros dois modais: selecionar texto num campo e soltar
  // o mouse no fundo fechava o dialogo e perdia o que estava digitado.
  const scrimProps = useFecharAoClicarFora(onFechar);
  return (
    <div
      {...scrimProps}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(16,24,40,0.45)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "10vh 16px 24px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 460,
          maxWidth: "100%",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: 24,
          boxShadow: "var(--shadow)",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 17, letterSpacing: "-0.02em" }}>{titulo}</h2>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onFechar}
            aria-label="Fechar"
            style={{ padding: "4px 10px" }}
          >
            <X size={15} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Rodape({
  onCancelar,
  onConfirmar,
  salvando,
  rotulo,
  perigo = false,
  desabilitado = false,
}: {
  onCancelar: () => void;
  onConfirmar: () => void;
  salvando: boolean;
  rotulo: string;
  perigo?: boolean;
  desabilitado?: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={onCancelar}
        disabled={salvando}
      >
        Cancelar
      </button>
      <button
        type="button"
        className="btn btn-primary"
        onClick={onConfirmar}
        disabled={salvando || desabilitado}
        style={perigo ? { background: "#dc2626", borderColor: "#dc2626" } : undefined}
      >
        {salvando ? "…" : rotulo}
      </button>
    </div>
  );
}
