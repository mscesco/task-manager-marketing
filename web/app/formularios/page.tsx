"use client";
// /formularios — os formulários de solicitação do workspace (Spec 043, fatia C).
//
// ⚠️ ATÉ AQUI ELES SÓ EXISTIAM NA API. A fatia A entregou o CRUD e disse, com
// todas as letras, que ele nascia sem chamador no front; esta é a tela que o
// chama. Sem ela, "cada equipe cria o seu formulário" significava `curl`.
//
// ⚠️ ESTA É A PRIMEIRA METADE DA FATIA C. Aqui se cria, publica e apaga um
// formulário; montar as SEÇÕES e PERGUNTAS dele é a segunda. A divisão é para
// você ver um formulário nascer antes de eu escrever o editor inteiro -- e
// porque um editor de perguntas com arrastar, tipos e condicional é grande o
// bastante para merecer entrega própria.

import { useEffect, useState } from "react";
import Link from "next/link";

import AppShell from "@/components/AppShell";
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
  const [ocupado, setOcupado] = useState<string | null>(null);

  // ⚠⚠ O time ativo vem da barra (Spec 048). Rota estática: `useSearchParams`
  // aqui derrubaria o build -- ver `lib/useActiveTeam.tsx`.
  const { active, teamName: nomeDoTimeAtivo } = useActiveTeam();
  const timeAtivo = useActiveTeamId();

  const [criando, setCriando] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [slug, setSlug] = useState("");
  const [time, setTime] = useState("");
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    // ⚠⚠ ESPERA A BARRA RESOLVER o time, em vez de listar sem recorte -- e
    // `active === null` ("ainda não sei") é diferente de `kind: "none"` ("sei
    // que não há time"), senão uma falha do `listTeamsAll()` do `AppShell`
    // deixaria esta tela carregando para sempre.
    if (active === null) return;
    listarFormularios(timeAtivo)
      .then(setItens)
      .catch((e: ApiError) => setErro(e.message));
    // ⚠️ `timeAtivo` NAS DEPENDÊNCIAS: trocar de time tem de refazer a lista.
    // ⚠️ `active === null` E NÃO `active`: o objeto é NOVO a cada render da
    // barra, e depender dele refazia o pedido a cada render -- vários pedidos
    // em voo, e o último a responder vencia (defeito de 14/09).
  }, [timeAtivo, active === null]);

  useEffect(() => {
    listTeamsAll()
      .then((t) => {
        setTimes(t);
        // ⚠⚠ O TIME ATIVO COMO PADRÃO, e ATÉ 11/09 ERA "a primeira raiz".
        // O comentário antigo dizia: *"em produção o Marketing É a raiz"* --
        // verdade quando foi escrito, e mentira desde a Spec 046. Com duas
        // raizes, `find(parent === null)` devolve a primeira que a API listar:
        // o formulário nasceria no Comercial enquanto a pessoa olha o
        // Marketing, em silêncio. É o mesmo defeito que o `createProject`
        // pagou em 10/09, e a mesma correção -- o contexto responde, ninguém
        // adivinha.
        // ⚠️ A RESERVA, para quando não há time ativo. O time ativo entra no
        // efeito abaixo, que sabe não pisar numa escolha já feita.
        setTime(
          (atual) => atual || (t.find((x) => x.parent_team_id === null)?.id ?? "")
        );
      })
      .catch(() => {});
    currentUser()
      .then((me) =>
        // Spec 049, fatia A: era `solicitation_form.manage`. `podeGerir` desenha
        // criar, publicar e apagar juntos; os verbos estao nos mesmos papeis,
        // e `form.update` e o que diz "mexer no formulario".
        setPodeGerir(me.permissions.includes("form.update"))
      )
      .catch(() => setPodeGerir(false));
  }, []);

  // ⚠⚠ O TIME ATIVO PREENCHE O CAMPO, E NÃO PISA NA ESCOLHA. `atual || ...`
  // e não `setTime(timeAtivo)`: o efeito roda de novo quando a barra resolve o
  // time (e a cada troca), e sobrescrever ali apagaria o time que a pessoa
  // acabou de escolher no formulário aberto.
  useEffect(() => {
    if (!timeAtivo) return;
    setTime((atual) => atual || timeAtivo);
  }, [timeAtivo]);

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
      // ⚠️ O BACKEND RECUSA SLUG INVÁLIDO E REPETIDO com mensagem própria, e é
      // ela que aparece -- reescrever aqui criaria uma segunda versão da regra
      // que divergiria na primeira mudança.
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
      // ⚠️ O 422 AQUI TEM CONTEÚDO: "um formulário sem perguntas não pode ser
      // publicado". É a mensagem que ensina o próximo passo, então ela aparece
      // inteira em vez de virar "não consegui".
      setErro((e as ApiError).message || "Não consegui mudar a publicação.");
    } finally {
      setOcupado(null);
    }
  }

  async function apagar(f: Formulario) {
    // ⚠️ O AVISO DIZ O QUE ACONTECE COM AS SOLICITAÇÕES, e isso não é zelo: o
    // soft delete marca o FORMULÁRIO e não toca nelas. Elas continuam na fila
    // (o `JOIN` é `LEFT`) e continuam legíveis, porque cada uma guarda o texto
    // das perguntas que respondeu. Quem lê "excluir formulário" imagina o
    // contrário.
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
        /* ⚠️ O NOME DO TIME, pelo mesmo motivo da fila e dos projetos: lista
           recortada que não diz pelo quê parece a lista inteira. */
        title={nomeDoTimeAtivo ? `Formulários · ${nomeDoTimeAtivo}` : "Formulários"}
        count={`${itens.length} ${itens.length === 1 ? "formulário" : "formulários"}`}
        actions={
          podeGerir &&
          !criando && (
            <button
              type="button"
              className="btn btn-primary"
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
              placeholder="Ex.: Solicitação ao Marketing"
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
              placeholder="marketing"
              value={slug}
              maxLength={60}
              disabled={salvando}
              onChange={(e) => setSlug(e.target.value)}
            />
            {/* ⚠️ MOSTRAR A URL INTEIRA, e não só o campo: o slug É o endereço
                que alguém vai divulgar, e ver `/solicitar/<isto>` na hora de
                digitar evita descobrir depois que ficou feio no cartaz. */}
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
              {times.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {/* ⚠️ ESCOLHA DEFINITIVA, e o aviso é obrigatório: o time decide
                QUEM TRIA as solicitações -- inclusive as que já chegaram --, e
                por isso o backend recusa trocá-lo depois. */}
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
        <div
          style={{
            display: "flex", flexDirection: "column", maxWidth: 1100,
            border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden",
          }}
        >
          {itens.map((f, i) => (
            <div
              key={f.id}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                minHeight: 56, padding: "12px 20px", background: "var(--surface)",
                borderTop: i === 0 ? "none" : "1px solid var(--border)",
                opacity: ocupado === f.id ? 0.6 : 1,
              }}
            >
              <span
                aria-hidden
                title={f.is_published ? "Publicado" : "Rascunho"}
                style={{
                  width: 9, height: 9, borderRadius: 999, flexShrink: 0,
                  background: f.is_published
                    ? "var(--status-done-dot)"
                    : "var(--border)",
                }}
              />
              {/* ⚠️ O TÍTULO É O LINK PARA O EDITOR, e é a razão de a Camila
                  ter perguntado "consigo criar mas onde eu edito?" (26/08): a
                  fatia C1 criava formulários que não tinham para onde ir, e o
                  primeiro deles bateu em "um formulário sem perguntas não pode
                  ser publicado" sem nenhum lugar onde pôr perguntas. */}
              <Link
                href={`/formularios/${f.id}`}
                style={{ fontSize: 15, fontWeight: 600, minWidth: 0 }}
              >
                {f.title}
              </Link>
              <code className="muted" style={{ fontSize: 12.5 }}>
                /solicitar/{f.slug}
              </code>
              <span className="muted" style={{ fontSize: 12.5 }}>
                {nomeDoTime(f.team_id)}
              </span>
              <span
                className="muted"
                style={{ fontSize: 12, marginLeft: "auto", flexShrink: 0 }}
              >
                {f.is_published ? "Publicado" : "Rascunho"}
              </span>
              {podeGerir && (
                <>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ fontSize: 12 }}
                    disabled={ocupado === f.id}
                    onClick={() => alternarPublicacao(f)}
                  >
                    {f.is_published ? "Despublicar" : "Publicar"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ fontSize: 12, color: "var(--danger)" }}
                    disabled={ocupado === f.id}
                    onClick={() => apagar(f)}
                  >
                    Excluir
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
