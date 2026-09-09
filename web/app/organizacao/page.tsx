"use client";
// app/organizacao/page.tsx
// A tela da ORGANIZACAO (Spec 047, fatia B).
//
// ⚠️⚠️ NAO EXISTIA TELA DE ORGANIZACAO. Renomear o workspace era rota sem
// tela desde sempre; esta e a primeira que a expoe. O que muda de verdade
// nao e visual, e ONDE cada coisa e administrada:
//
//     a organizacao administra AREAS
//     o time administra PESSOAS      (fatia C)
//     o painel administra VINCULOS   (fatia D)
//
// ⚠️ TODA DECISAO MORA EM `lib/organizacao.ts`, testada -- aqui so desenha.
// `app/` esta FORA do `include` do vitest (§7 da spec), e o projeto ja pagou
// por esquecer isso duas vezes: `candidatosParaAdicionar` (Spec 044) e
// `computeLens`, que deixou passar a regressao de 09/09 ate alguem ver na
// tela.
//
// ⚠️ SEM `useSearchParams` AQUI, e e deliberado: esta rota e ESTATICA
// (`○ /organizacao` no build), e `useSearchParams` sem fronteira de
// `Suspense` derruba o `next build` em rota estatica -- o `npm run dev` NAO
// reclama (AGENTS.md §6, e a §7 desta spec avisa de novo). Se um dia esta
// tela precisar de estado na URL, ou envolve em `Suspense`, ou aceita virar
// dinamica.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Pencil, Plus, Search, X } from "lucide-react";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import {
  ApiError,
  createTeam,
  currentUser,
  getWorkspace,
  listMembers,
  listTeamsAll,
  renameWorkspace,
  type CurrentUser,
  type Member,
  type Team,
  type Workspace,
} from "@/lib/api";
import {
  buscarPessoas,
  cardsDeArea,
  gestoresDaOrganizacao,
  pessoasSemArea,
} from "@/lib/organizacao";

const ROTULO_ORG: Record<string, string> = {
  ADMIN: "administradora",
  GESTOR: "gestora",
};

export default function OrganizacaoPage() {
  const [ws, setWs] = useState<Workspace | null>(null);
  const [times, setTimes] = useState<Team[]>([]);
  const [membros, setMembros] = useState<Member[]>([]);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");

  async function carregar() {
    setCarregando(true);
    try {
      const [w, t, m, u] = await Promise.all([
        getWorkspace(),
        listTeamsAll(),
        listMembers(),
        currentUser(),
      ]);
      setWs(w);
      setTimes(t);
      setMembros(m);
      setMe(u);
      setErro(null);
    } catch (e) {
      setErro((e as ApiError).message || "Não consegui carregar a organização.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void carregar();
  }, []);

  // ⚠️ Renomear exige `workspace.manage`; criar area exige `area.create`
  // (Spec 046, §4.1) -- e as duas SAO DIFERENTES: um GESTOR cria area e nao
  // renomeia a organizacao. Ler as duas separadas e o que impede a tela de
  // tratar "administra" como uma coisa so.
  const podeRenomear = me?.permissions.includes("workspace.manage") ?? false;
  const podeCriarArea = me?.permissions.includes("area.create") ?? false;

  const cards = useMemo(() => cardsDeArea(times, membros), [times, membros]);
  const gestores = useMemo(() => gestoresDaOrganizacao(membros), [membros]);
  const semArea = useMemo(() => pessoasSemArea(membros), [membros]);
  const achadas = useMemo(
    () => buscarPessoas(busca, membros, times),
    [busca, membros, times],
  );

  return (
    <AppShell>
      <PageHeader
        title={
          ws ? (
            <NomeDaOrganizacao
              nome={ws.name}
              podeEditar={podeRenomear}
              onRenomear={async (novo) => {
                const atualizado = await renameWorkspace(novo);
                setWs(atualizado);
              }}
            />
          ) : (
            "Organização"
          )
        }
        actions={
          podeCriarArea ? (
            <CriarArea onCriada={carregar} />
          ) : null
        }
      />

      {gestores.length > 0 && (
        <div
          className="muted"
          style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}
        >
          {gestores.map((g) => (
            <span key={g.id} className="badge badge-neutral">
              {g.name} · {ROTULO_ORG[g.org_role ?? ""] ?? "organização"}
            </span>
          ))}
        </div>
      )}

      {erro && <div className="error-box">{erro}</div>}

      {carregando ? (
        <div className="muted">Carregando…</div>
      ) : (
        <>
          {/* ---- busca por pessoa, atravessando as areas -------------------
              ⚠️ Não é enfeite: a grade é por ÁREA, então ela mostra o
              agregado e some com o indivíduo. "Onde está a Fulana?" não tem
              outra resposta nesta tela. */}
          <label
            className="field"
            style={{ maxWidth: 420, marginBottom: 20, display: "block" }}
          >
            <span className="label" style={{ display: "flex", gap: 6 }}>
              <Search size={14} aria-hidden="true" /> Encontrar pessoa
            </span>
            <input
              className="input"
              value={busca}
              placeholder="nome ou e-mail"
              onChange={(e) => setBusca(e.target.value)}
            />
          </label>

          {busca.trim() !== "" && (
            <div style={{ marginBottom: 24 }}>
              {achadas.length === 0 ? (
                <div className="muted">Ninguém com esse nome ou e-mail.</div>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {achadas.map(({ membro, areas }) => (
                    <li
                      key={membro.id}
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "baseline",
                        padding: "6px 0",
                        flexWrap: "wrap",
                      }}
                    >
                      <strong>{membro.name}</strong>
                      <span className="muted" style={{ fontSize: 12.5 }}>
                        {membro.email}
                      </span>
                      {areas.length === 0 ? (
                        <span className="badge badge-outline">sem área</span>
                      ) : (
                        areas.map((a) => (
                          <Link
                            key={a.id}
                            href={`/times/${a.id}`}
                            className="badge badge-soft"
                          >
                            {a.name}
                          </Link>
                        ))
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* ---- a grade de áreas ---------------------------------------- */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              gap: 14,
            }}
          >
            {cards.map(({ area, pessoas, subtimes }) => (
              <Link
                key={area.id}
                href={`/times/${area.id}`}
                className="card"
                style={{ display: "block", padding: 16 }}
              >
                <strong style={{ fontSize: 15 }}>{area.name}</strong>
                <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
                  {pessoas} {pessoas === 1 ? "pessoa" : "pessoas"} ·{" "}
                  {subtimes} {subtimes === 1 ? "subtime" : "subtimes"}
                </div>
              </Link>
            ))}

            {/* ⚠️ O CARD QUE IMPEDE GENTE INVISÍVEL. Sem ele, quem é
                cadastrado e nunca alocado não aparece em lugar nenhum do
                produto — a grade é feita de áreas. Some sozinho quando a
                lista está vazia. */}
            {semArea.length > 0 && (
              <div className="card" style={{ padding: 16 }}>
                <strong style={{ fontSize: 15 }}>Pessoas sem área</strong>
                <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
                  {semArea.length}{" "}
                  {semArea.length === 1 ? "pessoa" : "pessoas"} sem vínculo
                </div>
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: "10px 0 0",
                    fontSize: 12.5,
                  }}
                >
                  {semArea.map((m) => (
                    <li key={m.id} className="muted">
                      {m.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}

/** O nome da organização, editável no lugar. */
function NomeDaOrganizacao({
  nome,
  podeEditar,
  onRenomear,
}: {
  nome: string;
  podeEditar: boolean;
  onRenomear: (novo: string) => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(nome);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => setValor(nome), [nome]);

  if (!podeEditar || !editando) {
    return (
      <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
        {nome}
        {podeEditar && (
          <button
            className="btn btn-ghost"
            aria-label="Renomear a organização"
            onClick={() => {
              setErro(null);
              setEditando(true);
            }}
          >
            <Pencil size={14} aria-hidden="true" />
          </button>
        )}
      </span>
    );
  }

  async function salvar() {
    const novo = valor.trim();
    // ⚠️ Vazio não é renomear -- e o backend recusaria com 422. Barrar aqui
    // evita a viagem; a recusa de verdade continua sendo dele.
    if (novo === "" || novo === nome) {
      setEditando(false);
      setValor(nome);
      return;
    }
    setSalvando(true);
    try {
      await onRenomear(novo);
      setEditando(false);
      setErro(null);
    } catch (e) {
      const a = e as ApiError;
      setErro(
        a.status === 403
          ? "Só quem administra a organização pode renomeá-la."
          : a.message || "Não consegui renomear.",
      );
    } finally {
      setSalvando(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <input
        className="input"
        value={valor}
        disabled={salvando}
        autoFocus
        maxLength={255}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void salvar();
          if (e.key === "Escape") {
            setEditando(false);
            setValor(nome);
          }
        }}
        style={{ fontSize: 18, width: 280 }}
      />
      <button className="btn btn-ghost" onClick={() => void salvar()} disabled={salvando}>
        <Check size={16} aria-hidden="true" />
      </button>
      <button
        className="btn btn-ghost"
        onClick={() => {
          setEditando(false);
          setValor(nome);
        }}
        disabled={salvando}
      >
        <X size={16} aria-hidden="true" />
      </button>
      {erro && (
        <span className="error-box" style={{ fontSize: 12 }}>
          {erro}
        </span>
      )}
    </span>
  );
}

/** Criar uma ÁREA — time sem pai (Spec 046). */
function CriarArea({ onCriada }: { onCriada: () => Promise<void> }) {
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [slug, setSlug] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function criar() {
    setSalvando(true);
    try {
      // ⚠️ `parent_team_id` AUSENTE é o que faz disto uma ÁREA, e não um
      // subtime — é o mesmo endpoint, e o corpo é que decide (Spec 046).
      // ⚠️ Ausente, e não `""`: o backend tipa `uuid | None`, e string vazia
      // é 422. Ver o comentário em `createTeam`.
      await createTeam({ name: nome.trim(), slug: slug.trim() });
      setAberto(false);
      setNome("");
      setSlug("");
      setErro(null);
      await onCriada();
    } catch (e) {
      const a = e as ApiError;
      setErro(
        a.status === 403
          ? "Criar área exige papel de organização."
          : a.status === 409
          ? "Já existe um time com esse endereço."
          : a.message || "Não consegui criar a área.",
      );
    } finally {
      setSalvando(false);
    }
  }

  if (!aberto) {
    return (
      <button className="btn btn-primary" onClick={() => setAberto(true)}>
        <Plus size={14} aria-hidden="true" /> Nova área
      </button>
    );
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
      <input
        className="input"
        placeholder="Nome"
        value={nome}
        autoFocus
        disabled={salvando}
        maxLength={255}
        onChange={(e) => setNome(e.target.value)}
        style={{ width: 160 }}
      />
      <input
        className="input"
        placeholder="endereco"
        value={slug}
        disabled={salvando}
        onChange={(e) => setSlug(e.target.value)}
        style={{ width: 140 }}
      />
      <button
        className="btn btn-primary"
        onClick={() => void criar()}
        disabled={salvando || nome.trim() === "" || slug.trim() === ""}
      >
        Criar
      </button>
      <button className="btn btn-ghost" onClick={() => setAberto(false)} disabled={salvando}>
        Cancelar
      </button>
      {erro && <div className="error-box">{erro}</div>}
    </div>
  );
}
