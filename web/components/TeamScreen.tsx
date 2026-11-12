"use client";
// Tela de pessoas e estrutura de um time (raiz ou subtime).
// Alternador escolhe o assunto (pessoas/estrutura); abas, o recorte; o lápis abre a gaveta.
// As regras ficam em `lib/teamScreen.ts` e `lib/memberState.ts`.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Search } from "lucide-react";
import Tabs from "@/components/Tabs";
import Toggle from "@/components/Toggle";
import Badge from "@/components/Badge";
import Card from "@/components/Card";
import PageHeader from "@/components/PageHeader";
import Reveal from "@/components/Reveal";
import { useAvisar } from "@/components/Toasts";
import SubteamCardTile from "@/components/SubteamCardTile";
import TemporaryPassword from "@/components/TemporaryPassword";
import SubteamDrawer from "@/components/SubteamDrawer";
import MembersTable, { ROLE_LABEL } from "@/components/MembersTable";
import MemberDrawer from "@/components/MemberDrawer";
import {
  ApiError,
  createMember,
  createTeam,
  currentUser,
  listMembers,
  listTeamsAll,
  type CurrentUser,
  type Member,
  type MemberRole,
  type Team,
} from "@/lib/api";
import { subteamCards, teamRows } from "@/lib/teamScreen";
import {
  matchesSearch,
  papeisDeOrganizacaoAtribuiveis,
  podeAbrirOrganizacao,
} from "@/lib/organization";
import { countByState, memberState, type MemberState } from "@/lib/memberState";
import { podeEditar, sugereSlug } from "@/lib/gestaoTimes";
import {
  alcanceDe,
  papeisAtribuiveis,
  podeCadastrarMembro,
  podeMoverSubtime,
  temAcaoPossivel,
  type Alcance,
} from "@/lib/permissoesMembros";
import { lerEstadoDaTela, gravarEstadoDaTela } from "@/lib/estadoDaTela";

import Loading from "@/components/Loading";
import { DUR } from "@/lib/motion";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
type View = "people" | "structure";
type RevealedPassword = { title: string; email: string; password: string };

export default function TeamScreen({ teamId }: { teamId: string }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  // Avisos em pilha no canto (`Toasts`), para não empurrar a tela.
  const avisar = useAvisar();

  // O estado da tela mora na URL: sobrevive ao F5 e vira link.
  const inicial = lerEstadoDaTela();
  const [view, setView] = useState<View>(inicial.view);
  const [tab, setTab] = useState<MemberState>(inicial.tab);
  const [busca, setBusca] = useState("");
  const [criando, setCriando] = useState(false);
  const [revelado, setRevelado] = useState<RevealedPassword | null>(null);
  const [gavetaDeTime, setGavetaDeTime] = useState<Team | null>(null);
  // A gaveta da pessoa é da tela, para a tabela e a gaveta do subtime abrirem a mesma.
  const [gavetaDePessoa, setGavetaDePessoa] = useState<Member | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const [t, m, u] = await Promise.all([
        listTeamsAll(),
        listMembers(),
        currentUser(),
      ]);
      setTeams(t);
      setMembers(m);
      setMe(u);
      setErro(null);
    } catch (e) {
      setErro((e as ApiError).message || "Não consegui carregar.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const team = teams.find((t) => t.id === teamId) ?? null;
  useDocumentTitle(team?.name);

  const rows = useMemo(
    () => teamRows(teamId, teams, members),
    [teamId, teams, members],
  );

  const cards = useMemo(
    () => subteamCards(teamId, teams, members),
    [teamId, teams, members],
  );

  // A busca define o universo em que as abas contam.
  const filtrando = busca.trim() !== "";
  const buscadas = useMemo(
    () => (filtrando ? rows.filter((r) => matchesSearch(busca, r.member)) : rows),
    [rows, busca, filtrando],
  );
  const count = useMemo(
    () => countByState(buscadas.map((r) => r.member)),
    [buscadas],
  );
  const visiveis = useMemo(
    () => buscadas.filter((r) => memberState(r.member) === tab),
    [buscadas, tab],
  );

  const scope = alcanceDe(me);
  const isAdmin = me?.roles.includes("ADMIN") ?? false;
  const podeMexerEmTimes = podeMoverSubtime(scope);

  if (!loading && !team) {
    return (
      <div className="muted">
        Time não encontrado. Volte para a{" "}
        <Link href="/organizacao" className="text-accent underline">
          organização
        </Link>
        .
      </div>
    );
  }

  const isRoot = team?.parent_team_id === null;
  // Voltar sobe um nível (link para o pai), não usa o histórico do navegador.
  const pai = team?.parent_team_id
    ? teams.find((t) => t.id === team.parent_team_id) ?? null
    : null;

  // Num time raiz, o nível de cima é a organização, só para quem a alcança
  // (`org_role` não nulo, como no `AppShell`).
  const podeVerOrganizacao = podeAbrirOrganizacao(me);
  const voltar = pai
    ? { href: `/times/${pai.id}`, label: pai.name }
    : podeVerOrganizacao
      ? { href: "/organizacao", label: "Organização" }
      : null;

  const podeAgir =
    view === "people" ? podeCadastrarMembro(scope) : podeMexerEmTimes;

  return (
    <>
      {voltar && (
        <a
          href={voltar.href}
          className="muted mb-2 inline-flex items-center gap-1.5 text-xs hover:text-accent"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          {voltar.label}
        </a>
      )}

      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            {team ? team.name : "Time"}
            {/* Diz o nível: num time raiz aparece a árvore inteira. */}
            {team && (
              <Badge tone="outline" size="sm">
                {isRoot ? "Time" : "Subtime"}
              </Badge>
            )}
          </span>
        }
        // "N de M", nunca só N.
        count={
          visiveis.length === rows.length
            ? rows.length
            : `${visiveis.length} de ${rows.length}`
        }
        actions={
          podeAgir &&
          !criando && (
            <button
              className="btn btn-primary ml-auto"
              style={{ padding: "8px 14px" }}
              onClick={() => setCriando(true)}
            >
              {view === "people" ? "+ Novo membro" : "+ Novo subtime"}
            </button>
          )
        }
      />

      {erro && <div className="error-box">{erro}</div>}

      {revelado && (
        <TemporaryPassword
          title={revelado.title}
          email={revelado.email}
          password={revelado.password}
          onClose={() => setRevelado(null)}
        />
      )}

      {/* Alternador: pastilha única que anda, diferente das abas de baixo. */}
      <div className="mb-4">
        <Toggle
          aria-label="O que ver"
          active={view}
          onSelect={(v) => {
            setView(v);
            gravarEstadoDaTela({ view: v, tab });
            // Fecha o formulário ao virar a chave: ele pertence ao assunto anterior.
            setCriando(false);
          }}
          sides={[
            { id: "people", label: "Membros", count: rows.length },
            { id: "structure", label: "Subtimes", count: cards.length },
          ]}
        />
      </div>

      {/* Troca de assunto com transição, para não parecer recarga. */}
      {loading ? (
        <Loading />
      ) : (
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -10, opacity: 0 }}
            transition={{ duration: DUR[2] }}
          >
            {view === "people" ? (
              <>
                {/* `Reveal`: sem transição, a tabela salta. */}
                <Reveal show={criando && team !== null}>
                  {team && (
                    <NewMember
                      team={team}
                      scope={scope}
                      isAdmin={isAdmin}
                      onCancel={() => setCriando(false)}
                      onCreated={async (r, texto) => {
                        setRevelado(r);
                        setCriando(false);
                        avisar(texto);
                        await carregar();
                      }}
                    />
                  )}
                </Reveal>

                {/* Busca, nos dois níveis. */}
                <label className="mb-4 block max-w-[420px]">
                  <span className="label flex items-center gap-1.5">
                    <Search size={14} aria-hidden="true" /> Encontrar pessoa
                  </span>
                  <input
                    className="input mt-1.5 w-full"
                    value={busca}
                    placeholder="Nome ou e-mail"
                    onChange={(e) => setBusca(e.target.value)}
                  />
                </label>

                {rows.length === 0 ? (
                  <div className="muted">Ninguém aqui ainda.</div>
                ) : buscadas.length === 0 ? (
                  <div className="muted">Ninguém com esse nome ou e-mail.</div>
                ) : (
                  <>
                    {/* Abas com contagem; `count: 0` mostra "0". */}
                    <div className="mb-3">
                      <Tabs
                        aria-label="Estado das pessoas"
                        group="estado"
                        active={tab}
                        onSelect={(t) => {
                          setTab(t);
                          gravarEstadoDaTela({ view, tab: t });
                        }}
                        tabs={[
                          { id: "active", label: "Ativos", count: count.active },
                          {
                            id: "invited",
                            label: "Convidados",
                            count: count.invited,
                          },
                          {
                            id: "inactive",
                            label: "Inativos",
                            count: count.inactive,
                          },
                        ]}
                      />
                    </div>

                    <AnimatePresence mode="wait">
                      <motion.div
                        key={tab}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: DUR[2] }}
                      >
                        {visiveis.length === 0 ? (
                          <div className="muted rounded-lg border border-border bg-surface p-4 text-sm">
                            {emptyStateText(tab)}
                          </div>
                        ) : (
                          <MembersTable
                            rows={visiveis}
                            middleColumn={middleColumn}
                            count={`${visiveis.length} de ${rows.length} pessoas`}
                            // Só para quem tem o que fazer (`temAcaoPossivel`), por linha.
                            podeAbrir={(row) =>
                              temAcaoPossivel(
                                scope,
                                row.member.team_ids ?? [],
                              )
                            }
                            onOpenMember={setGavetaDePessoa}
                          />
                        )}
                      </motion.div>
                    </AnimatePresence>
                  </>
                )}
              </>
            ) : (
              <>
                <Reveal show={criando && team !== null}>
                  {team && (
                    <NewSubteam
                      parent={team}
                      onCancel={() => setCriando(false)}
                      onCreated={async (texto) => {
                        setCriando(false);
                        avisar(texto);
                        await carregar();
                      }}
                    />
                  )}
                </Reveal>

                {cards.length === 0 ? (
                  <div className="muted">
                    Nenhum subtime dentro de {team?.name}.
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {cards.map((c) => (
                      <SubteamCardTile
                        key={c.team.id}
                        card={c}
                        // O lápis também abre para quem edita este subtime; decide o servidor (`can_update`).
                        canManage={podeMexerEmTimes || podeEditar(c.team)}
                        onEdit={() => setGavetaDeTime(c.team)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </motion.div>
        </AnimatePresence>
      )}

      <AnimatePresence>
        {gavetaDeTime && (
          <SubteamDrawer
            key={gavetaDeTime.id}
            team={gavetaDeTime}
            members={members}
            isAdmin={isAdmin}
            canManage={podeMexerEmTimes}
            scope={scope}
            permissoes={me?.permissions ?? []}
            onClose={() => setGavetaDeTime(null)}
            onChanged={async (texto) => {
              setGavetaDeTime(null);
              avisar(texto);
              await carregar();
            }}
            // Recarrega sem fechar: adicionar gente é operação em série.
            onRefresh={carregar}
          />
        )}
      </AnimatePresence>

      {/* A gaveta desenha a própria senha provisória; esta só serve ao cadastro. */}
      <AnimatePresence>
        {gavetaDePessoa && (
          <MemberDrawer
            key={gavetaDePessoa.id}
            member={gavetaDePessoa}
            teams={teams}
            scope={scope}
            permissoes={me?.permissions ?? []}
            isAdmin={isAdmin}
            opcoesDeOrganizacao={
              me
                ? papeisDeOrganizacaoAtribuiveis(me, gavetaDePessoa.org_role ?? null)
                : null
            }
            isSelf={gavetaDePessoa.id === me?.id}
            onClose={() => setGavetaDePessoa(null)}
            onChanged={async (texto) => {
              setGavetaDePessoa(null);
              avisar(texto);
              await carregar();
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}

/** Coluna do meio da tabela: o cargo da pessoa neste time. */
const middleColumn = {
  title: "Cargo aqui",
  render: (r: { cargoAqui: MemberRole | null }) =>
    r.cargoAqui ? (
      <Badge tone="neutral" size="sm" className="border">
        {ROLE_LABEL[r.cargoAqui]}
      </Badge>
    ) : (
      <span className="muted text-xs">—</span>
    ),
};

/** O vazio de cada aba diz por que está vazio. */
function emptyStateText(tab: MemberState): string {
  switch (tab) {
    case "active":
      return "Ninguém ativo neste recorte — veja as outras abas.";
    case "invited":
      return "Ninguém pendente: todo mundo já entrou pelo menos uma vez.";
    case "inactive":
      return "Ninguém desativado neste recorte.";
  }
}

/** Cadastrar pessoa nova já neste time (sem seletor de time). */
function NewMember({
  team,
  scope,
  isAdmin,
  onCancel,
  onCreated,
}: {
  team: Team;
  scope: Alcance;
  isAdmin: boolean;
  onCancel: () => void;
  onCreated: (revealed: RevealedPassword, aviso: string) => Promise<void>;
}) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");

  // Opções de `papeisAtribuiveis` com o nível deste time:
  // no time raiz não cabe SUPERVISOR; num subtime não cabe MANAGER.
  const opcoes = papeisAtribuiveis(
    scope,
    isAdmin,
    team.parent_team_id === null,
  );
  const [papel, setPapel] = useState<MemberRole | "">("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const papelValido = papel !== "" && opcoes.includes(papel);

  return (
    <Card className="mb-4 flex flex-col gap-3">
      <div className="field">
        <span className="label">Nome</span>
        <input
          className="input"
          value={nome}
          disabled={salvando}
          autoFocus
          maxLength={255}
          onChange={(e) => setNome(e.target.value)}
        />
      </div>
      <div className="field">
        <span className="label">E-mail</span>
        <input
          className="input"
          type="email"
          value={email}
          disabled={salvando}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="field min-w-[180px] flex-1">
          <span className="label">Cargo em {team.name}</span>
          <select
            className="input"
            value={papel}
            disabled={salvando}
            onChange={(e) => setPapel(e.target.value as MemberRole | "")}
          >
            <option value="">—</option>
            {opcoes.map((p) => (
              <option key={p} value={p}>
                {ROLE_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="muted text-xs">
        A pessoa recebe uma senha provisória, mostrada uma única vez aqui, e
        troca no primeiro acesso.
      </div>

      {erro && <div className="error-box">{erro}</div>}

      <div className="flex gap-2">
        <button
          className="btn btn-primary"
          style={{ padding: "8px 14px" }}
          disabled={salvando || !nome.trim() || !email.trim() || !papelValido}
          onClick={async () => {
            if (papel === "") return;
            setSalvando(true);
            setErro(null);
            try {
              const novo = await createMember({
                name: nome.trim(),
                email: email.trim(),
                teamId: team.id,
                role: papel,
              });
              await onCreated(
                {
                  title: `Membro cadastrado: ${novo.name}`,
                  email: novo.email,
                  password: novo.temporary_password,
                },
                `${novo.name} entrou em ${team.name} como ${ROLE_LABEL[
                  papel
                ].toLowerCase()}.`,
              );
            } catch (e) {
              const a = e as ApiError;
              setErro(
                a.status === 409
                  ? "Já existe um membro com esse e-mail."
                  : a.status === 422
                  ? "Dados inválidos — confira o e-mail."
                  : a.status === 403
                  ? "Você não administra este time."
                  : a.message || "Não consegui cadastrar.",
              );
            } finally {
              setSalvando(false);
            }
          }}
        >
          {salvando ? "Cadastrando…" : "Cadastrar"}
        </button>
        <button
          className="btn btn-ghost"
          style={{ padding: "8px 14px" }}
          disabled={salvando}
          onClick={onCancel}
        >
          Cancelar
        </button>
      </div>
    </Card>
  );
}

/** Criar um subtime dentro do time aberto. Time raiz se cria na `/organizacao`. */
function NewSubteam({
  parent,
  onCancel,
  onCreated,
}: {
  parent: Team;
  onCancel: () => void;
  onCreated: (aviso: string) => Promise<void>;
}) {
  const [nome, setNome] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTocado, setSlugTocado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  return (
    <Card className="mb-4 flex flex-col gap-3">
      <div className="field">
        <span className="label">Nome</span>
        <input
          className="input"
          value={nome}
          disabled={salvando}
          autoFocus
          onChange={(e) => {
            setNome(e.target.value);
            // Sugere o identificador até a pessoa editá-lo; o backend só aceita `^[a-z0-9-]+$`.
            if (!slugTocado) setSlug(sugereSlug(e.target.value));
          }}
        />
      </div>
      <div className="field max-w-[280px]">
        <span className="label">Identificador</span>
        <input
          className="input"
          value={slug}
          disabled={salvando}
          onChange={(e) => {
            setSlugTocado(true);
            setSlug(e.target.value);
          }}
        />
      </div>

      <div className="muted text-xs">
        Vai ficar dentro de <strong>{parent.name}</strong>.
      </div>

      {erro && <div className="error-box">{erro}</div>}

      <div className="flex gap-2">
        <button
          className="btn btn-primary"
          style={{ padding: "8px 14px" }}
          disabled={salvando || !nome.trim() || !slug.trim()}
          onClick={async () => {
            setSalvando(true);
            setErro(null);
            try {
              await createTeam({
                name: nome.trim(),
                slug: slug.trim(),
                parent_team_id: parent.id,
              });
              await onCreated(
                `${nome.trim()} criado dentro de ${parent.name}.`,
              );
            } catch (e) {
              const a = e as ApiError;
              setErro(
                a.status === 403
                  ? "Você não tem permissão para criar times."
                  : a.status === 409
                  ? "Já existe um time com esse identificador."
                  : a.status === 422
                  ? "Identificador inválido: use só letras minúsculas, números e hífen."
                  : a.message || "Não consegui criar.",
              );
            } finally {
              setSalvando(false);
            }
          }}
        >
          {salvando ? "Criando…" : "Criar subtime"}
        </button>
        <button
          className="btn btn-ghost"
          style={{ padding: "8px 14px" }}
          disabled={salvando}
          onClick={onCancel}
        >
          Cancelar
        </button>
      </div>
    </Card>
  );
}
