"use client";
// /formularios: criar, publicar e apagar os formulários de solicitação do workspace.

import { timePadraoDoFormulario, timesQueCriamFormulario } from "@/lib/timesDoFormulario";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Link2 } from "lucide-react";

import AppShell from "@/components/AppShell";
import Badge from "@/components/Badge";
import PageHeader from "@/components/PageHeader";
import { useActiveTeam, useActiveTeamId } from "@/lib/useActiveTeam";
import Loading from "@/components/Loading";
import {
  ApiError,
  apagarFormulario,
  criarFormulario,
  currentUser,
  listTeamsAll,
  listarFormularios,
  publicarFormulario,
  type Formulario,
  type Team,
} from "@/lib/api";

export default function FormulariosPage() {
  return (
    <AppShell>
      <Formularios />
    </AppShell>
  );
}

function Formularios() {
  const [itens, setItens] = useState<Formulario[] | null>(null);
  const [times, setTimes] = useState<Team[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [podeGerir, setPodeGerir] = useState(false);
  // Separado de `podeGerir`: o gestor edita e publica, mas não apaga.
  const [podeApagar, setPodeApagar] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);

  // Time ativo vem da barra: `useSearchParams` aqui quebraria o build da rota estática.
  const { active, teamName: nomeDoTimeAtivo } = useActiveTeam();
  const timeAtivo = useActiveTeamId();

  const [criando, setCriando] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [slug, setSlug] = useState("");
  const [time, setTime] = useState("");
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    // Espera a barra resolver. `active === null` ("ainda não sei") difere de
    // `kind: "none"` ("sem time"), senão uma falha da barra carregaria para sempre.
    if (active === null) return;
    listarFormularios(timeAtivo)
      .then(setItens)
      .catch((e: ApiError) => setErro(e.message));
    // `active === null`, não `active`: o objeto é novo a cada render e refaria o pedido.
  }, [timeAtivo, active === null]);

  useEffect(() => {
    listTeamsAll()
      .then((t) => {
        setTimes(t);
        // O time pre-escolhido sai do efeito abaixo (`timePadraoDoFormulario`).
      })
      .catch(() => {});
    currentUser()
      .then((me) => {
        // `form.update` desenha criar e publicar.
        setPodeGerir(me.permissions.includes("form.update"));
        setPodeApagar(me.permissions.includes("form.delete"));
      })
      .catch(() => {
        setPodeGerir(false);
        setPodeApagar(false);
      });
  }, []);

  // `atual || ...`: o efeito roda de novo quando a barra resolve o time, e não
  // pode apagar a escolha já feita. Só entre os times em que a pessoa cria
  // (regra em `lib/timesDoFormulario`).
  useEffect(() => {
    if (times.length === 0) return;
    setTime((atual) => atual || timePadraoDoFormulario(times, timeAtivo));
  }, [times, timeAtivo]);

  function nomeDoTime(id: string) {
    return times.find((t) => t.id === id)?.name ?? "—";
  }

  async function criar() {
    const t = titulo.trim();
    const s = slug.trim().toLowerCase();
    if (!t || !s || !time) return;
    setSalvando(true);
    setErroForm(null);
    try {
      const novo = await criarFormulario({ team_id: time, slug: s, title: t });
      setItens((prev) => [...(prev ?? []), novo]);
      setTitulo("");
      setSlug("");
      setCriando(false);
    } catch (e) {
      const err = e as ApiError;
      // A mensagem do backend (slug inválido ou repetido) aparece como veio: não duplicar a regra.
      setErroForm(err.message || "Não consegui criar o formulário.");
    } finally {
      setSalvando(false);
    }
  }

  async function alternarPublicacao(f: Formulario) {
    setOcupado(f.id);
    setErro(null);
    try {
      const atualizado = await publicarFormulario(f.id, !f.is_published);
      setItens((prev) =>
        (prev ?? []).map((x) => (x.id === f.id ? atualizado : x))
      );
    } catch (e) {
      // O 422 ("sem perguntas não pode ser publicado") ensina o próximo passo: mostrar inteiro.
      setErro((e as ApiError).message || "Não consegui mudar a publicação.");
    } finally {
      setOcupado(null);
    }
  }

  async function apagar(f: Formulario) {
    // O soft delete marca só o formulário: as solicitações continuam na fila e
    // legíveis, porque cada uma guarda o texto das perguntas que respondeu.
    const ok = window.confirm(
      `Excluir o formulário “${f.title}”?\n\n` +
        "As solicitações que já chegaram por ele NÃO são apagadas: continuam " +
        "na fila, com as respostas que foram dadas.\n\n" +
        (f.is_published
          ? "⚠️ Ele está PUBLICADO — o endereço sai do ar imediatamente."
          : "")
    );
    if (!ok) return;
    setOcupado(f.id);
    setErro(null);
    try {
      await apagarFormulario(f.id);
      setItens((prev) => (prev ?? []).filter((x) => x.id !== f.id));
    } catch (e) {
      setErro((e as ApiError).message || "Não consegui excluir.");
    } finally {
      setOcupado(null);
    }
  }

  if (erro && itens === null) {
    return <div className="error-box" style={{ maxWidth: 480 }}>{erro}</div>;
  }
  if (itens === null) return <Loading />;

  return (
    <div>
      <PageHeader
        /* O nome do time diz que a lista está recortada. */
        title={nomeDoTimeAtivo ? `Formulários · ${nomeDoTimeAtivo}` : "Formulários"}
        count={`${itens.length} ${itens.length === 1 ? "formulário" : "formulários"}`}
        actions={
          podeGerir &&
          !criando && (
            <button
              type="button"
              className="btn btn-primary ml-auto"
              onClick={() => setCriando(true)}
            >
              + Novo formulário
            </button>
          )
        }
      />

      {erro && (
        <div className="error-box" style={{ maxWidth: 860, marginBottom: 14 }} role="alert">
          {erro}
        </div>
      )}

      {criando && (
        <div
          style={{
            maxWidth: 860, marginBottom: 18, padding: 16, borderRadius: 12,
            border: "1px solid var(--border)", background: "var(--surface)",
            display: "flex", flexDirection: "column", gap: 12,
          }}
        >
          <div className="field">
            <label className="label" htmlFor="f-titulo">Título</label>
            <input
              id="f-titulo"
              className="input"
              autoFocus
              placeholder="Ex.: Pedido de suporte"
              value={titulo}
              maxLength={120}
              disabled={salvando}
              onChange={(e) => setTitulo(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="f-slug">Endereço</label>
            <input
              id="f-slug"
              className="input"
              placeholder="pedido-de-suporte"
              value={slug}
              maxLength={60}
              disabled={salvando}
              onChange={(e) => setSlug(e.target.value)}
            />
            {/* A URL inteira: o slug é o endereço que alguém vai divulgar. */}
            <span className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              O formulário ficará em <code>/solicitar/{slug.trim() || "…"}</code>.
              Só letras minúsculas, números e hífen.
            </span>
          </div>
          <div className="field">
            <label className="label" htmlFor="f-time">Time responsável</label>
            <select
              id="f-time"
              className="input"
              value={time}
              disabled={salvando}
              onChange={(e) => setTime(e.target.value)}
            >
              {!time && (
                <option value="" disabled>
                  Escolha o time…
                </option>
              )}
              {/* Só os times em que a pessoa cria (`can_create_form`, decidido pelo servidor). */}
              {timesQueCriamFormulario(times).map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {/* O time decide quem tria as solicitações, e o backend recusa trocá-lo depois. */}
            <span className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              É o time que vai receber as solicitações na fila.{" "}
              <strong>Não dá para mudar depois.</strong>
            </span>
          </div>
          {erroForm && <div className="error-box">{erroForm}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={salvando}
              onClick={() => {
                setCriando(false);
                setErroForm(null);
              }}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={salvando || !titulo.trim() || !slug.trim() || !time}
              onClick={criar}
            >
              {salvando ? "Criando…" : "Criar"}
            </button>
          </div>
        </div>
      )}

      {itens.length === 0 ? (
        <p className="muted" style={{ fontSize: 14 }}>
          Nenhum formulário ainda. Crie o primeiro para o seu time receber
          solicitações por um endereço próprio.
        </p>
      ) : (
        /* O editor abre em /formularios/<id>, com esta mesma lista ao lado. */
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
          {itens.map((f) => (
            <div
              key={f.id}
              className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-[18px] transition-[border-color,box-shadow] duration-200 hover:border-accent"
              style={{ opacity: ocupado === f.id ? 0.6 : 1 }}
            >
              <span className="flex items-start gap-2">
                {/* O título é o link para o editor. */}
                <Link
                  href={`/formularios/${f.id}`}
                  className="min-w-0 flex-1 truncate text-md font-bold text-ink no-underline hover:text-accent"
                >
                  {f.title}
                </Link>
                {f.is_published ? (
                  <Badge tone="soft" size="sm" color="var(--teal)" className="shrink-0">
                    Publicado
                  </Badge>
                ) : (
                  <Badge tone="neutral" size="sm" weight="semibold" className="shrink-0 bg-surface-2 text-ink-soft">
                    Rascunho
                  </Badge>
                )}
              </span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
                {f.is_published ? (
                  <a
                    href={`/solicitar/${f.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-mono hover:text-accent"
                    title="Abrir o formulário público"
                  >
                    <Link2 size={12} aria-hidden />
                    /solicitar/{f.slug}
                  </a>
                ) : (
                  <code>/solicitar/{f.slug}</code>
                )}
                <span>{nomeDoTime(f.team_id)}</span>
              </span>
              <span className="mt-auto flex items-center gap-1 border-t border-border pt-2">
                <Link href={`/formularios/${f.id}`} className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }}>
                  Editar perguntas
                </Link>
                {podeGerir && (
                  <>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 12, padding: "4px 10px" }}
                      disabled={ocupado === f.id}
                      onClick={() => alternarPublicacao(f)}
                    >
                      {f.is_published ? "Despublicar" : "Publicar"}
                    </button>
                    {podeApagar && (
                      <button
                        type="button"
                        className="btn btn-ghost ml-auto"
                        style={{ fontSize: 12, padding: "4px 10px", color: "var(--danger)" }}
                        disabled={ocupado === f.id}
                        onClick={() => apagar(f)}
                      >
                        Excluir
                      </button>
                    )}
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
