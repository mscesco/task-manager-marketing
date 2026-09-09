"use client";
// components/TeamScreen.tsx
// A tela de pessoas e estrutura — Spec 047; unificada em 09/09.
//
// ⚠️⚠️ UMA TELA SÓ, PARA OS TRÊS NÍVEIS. Ela serve a ORGANIZAÇÃO inteira, uma
// ÁREA e um SUBTIME, e a decisão é da Camila, olhando as duas telas lado a
// lado: *"elas não são a mesma tela. eu quero que seja literalmente a mesma
// tela, com o toggle de subtimes e tudo"*.
//
// E ela está certa sobre o modelo: os três níveis fazem as MESMAS duas
// perguntas — *quem está aqui* e *o que tem dentro daqui*. O que muda é só o
// recorte:
//
//     team = null   -> a organização: todo mundo, e as ÁREAS lá dentro
//     área          -> quem está na árvore dela, e os SUBTIMES lá dentro
//     subtime       -> quem está nele e abaixo, e os subtimes dele
//
// ⚠️ E ISSO NÃO É ECONOMIA DE CÓDIGO, é a §5 da spec: *"duas telas listando
// pessoas, com regras diferentes, é o começo do próximo defeito de contador"*.
// Antes desta unificação a `/membros` já dividia a TABELA com a tela de time,
// mas tinha estrutura própria — sem alternador, sem a visão de subtimes — e as
// duas iam divergir de novo na próxima mudança.
//
// A divisão de dentro:
//
//     o alternador   escolhe o ASSUNTO   (pessoas ou estrutura)
//     as abas        escolhem o RECORTE  (ativos, convidados, inativos)
//     o lápis        abre a GAVETA       (a única porta de edição)
//
// ⚠️ E O BOTÃO DE AÇÃO SEGUE O ALTERNADOR, por decisão dela: *"o botão de novo
// membro muda de acordo com o toggle"*. Dois botões fixos, um deles sempre
// fora de assunto, é o que a troca evita.
//
// ⚠️ TODA DECISÃO MORA EM `lib/teamScreen.ts` e `lib/memberState.ts`,
// testadas. `app/` está fora do `include` do vitest, e é por isso que esta
// tela mora em `components/`: as regras mais delicadas (quem aparece, quem é
// "convidado") são justamente as que não dão erro quando saem erradas.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Pencil, Search } from "lucide-react";
import Tabs from "@/components/Tabs";
import Toggle from "@/components/Toggle";
import Badge from "@/components/Badge";
import Card from "@/components/Card";
import PageHeader from "@/components/PageHeader";
import TemporaryPassword from "@/components/TemporaryPassword";
import SubteamDrawer from "@/components/SubteamDrawer";
import MembersTable, { ROLE_LABEL } from "@/components/MembersTable";
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
import { organizationRows, subteamCards, teamRows } from "@/lib/teamScreen";
import { matchesSearch } from "@/lib/organization";
import { countByState, memberState, type MemberState } from "@/lib/memberState";
import { sugereSlug } from "@/lib/gestaoTimes";
import {
  alcanceDe,
  papeisAtribuiveis,
  podeCadastrarMembro,
  podeMoverSubtime,
  type Alcance,
} from "@/lib/permissoesMembros";

type View = "people" | "structure";
type RevealedPassword = { title: string; email: string; password: string };

export default function TeamScreen({ teamId }: { teamId: string | null }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [view, setView] = useState<View>("people");
  const [tab, setTab] = useState<MemberState>("active");
  const [busca, setBusca] = useState("");
  const [criando, setCriando] = useState(false);
  const [revelado, setRevelado] = useState<RevealedPassword | null>(null);
  const [gavetaDeTime, setGavetaDeTime] = useState<Team | null>(null);

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

  const team = teamId ? teams.find((t) => t.id === teamId) ?? null : null;

  // ⚠️ AS DUAS FUNÇÕES DEVOLVEM O MESMO FORMATO (`TeamRow`), e é isso que
  // permite a tela ser uma só. Elas diferem no UNIVERSO, não na forma.
  const rows = useMemo(
    () =>
      teamId
        ? teamRows(teamId, teams, members)
        : organizationRows(teams, members),
    [teamId, teams, members],
  );

  // ⚠️⚠️ `subteamCards(null, …)` DEVOLVE AS ÁREAS, e não é truque: a função
  // filtra `parent_team_id === teamId`, e área é justamente o time cujo pai é
  // `null`. A organização é o nível de cima da MESMA árvore — foi por isso que
  // a unificação coube sem uma segunda regra de contagem.
  const cards = useMemo(
    () => subteamCards(teamId, teams, members),
    [teamId, teams, members],
  );

  // ⚠️ DOIS RECORTES, e a ordem importa para os números: a BUSCA define o
  // universo em que as abas contam. Contando as abas sobre todo mundo, buscar
  // "ana" mostraria "Convidados 7" com uma Ana só na tela.
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
  // ⚠️ CRIAR ÁREA É OUTRA PERMISSÃO, e não a mesma de criar subtime: `area.create`
  // existe SÓ nos papéis de organização (Spec 046, §4.1), enquanto `team.manage`
  // um gerente também tem. Era o gate da entrada de menu "Organização".
  const podeCriarArea = me?.permissions.includes("area.create") ?? false;
  const podeMexerEmTimes = teamId ? podeMoverSubtime(scope) : podeCriarArea;

  if (!loading && teamId && !team) {
    return (
      <div className="muted">
        Time não encontrado. Volte para as{" "}
        <Link href="/membros" className="text-accent underline">
          pessoas da organização
        </Link>
        .
      </div>
    );
  }

  const ehArea = team?.parent_team_id === null;
  const naOrganizacao = teamId === null;

  // ⚠️ O NÍVEL DE BAIXO TEM NOME DIFERENTE em cada nível, e usar "subtime" na
  // organização seria errado: o que está dentro da organização são ÁREAS.
  const nomeDoNivelDeBaixo = naOrganizacao ? "área" : "subtime";
  const nomeDoNivelDeBaixoPlural = naOrganizacao ? "Áreas" : "Subtimes";

  const podeAgir =
    view === "people" ? podeCadastrarMembro(scope) : podeMexerEmTimes;

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            {naOrganizacao ? "Pessoas" : team ? team.name : "Time"}
            {/* ⚠️ Diz o NÍVEL, porque a tela é a mesma para os três e o
                conteúdo muda: na organização aparece todo mundo; numa área,
                a árvore dela; num subtime, ele e o que está abaixo. */}
            <Badge tone="outline" size="sm">
              {naOrganizacao ? "Organização" : ehArea ? "Área" : "Subtime"}
            </Badge>
          </span>
        }
        // ⚠️ "N de M", nunca só N. A §3.2: o defeito de 27/07 foi o cabeçalho
        // divergindo do corpo, e mostrar só o filtrado apaga a informação de
        // que existe mais.
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
              {view === "people"
                ? "+ Novo membro"
                : `+ Nova ${nomeDoNivelDeBaixo}`}
            </button>
          )
        }
      />

      {erro && <div className="error-box">{erro}</div>}

      {aviso && (
        <div role="status" className="muted mb-4 flex items-center gap-2 text-xs">
          <span>{aviso}</span>
          <button
            className="btn btn-ghost px-1.5 text-xs"
            onClick={() => setAviso(null)}
          >
            Entendi
          </button>
        </div>
      )}

      {revelado && (
        <TemporaryPassword
          title={revelado.title}
          email={revelado.email}
          password={revelado.password}
          onClose={() => setRevelado(null)}
        />
      )}

      {/* ---- O ALTERNADOR ------------------------------------------------
          ⚠️ COMPONENTE DIFERENTE das abas de baixo, e não a mesma coisa com
          outra cor: aqui a pastilha é UM `<motion.div layout />` que anda; lá
          o indicador são duas instâncias que o `layoutId` interpola. A forma
          distinta é o que separa "troquei de assunto" de "recortei a lista". */}
      <div className="mb-4">
        <Toggle
          aria-label="O que ver"
          active={view}
          onSelect={(v) => {
            setView(v);
            // ⚠️ Fecha o formulário ao virar a chave: ele pertence ao assunto
            // anterior, e deixá-lo aberto criaria uma área a partir de um
            // formulário que a pessoa abriu para cadastrar gente.
            setCriando(false);
          }}
          sides={[
            { id: "people", label: "Membros", count: rows.length },
            {
              id: "structure",
              label: nomeDoNivelDeBaixoPlural,
              count: cards.length,
            },
          ]}
        />
      </div>

      {/* ---- A TROCA DE ASSUNTO ------------------------------------------
          ⚠️ A tela inteira ENTRA subindo e SAI subindo, e não é enfeite: virar
          a chave troca todo o conteúdo abaixo do alternador — de uma tabela de
          pessoas para uma grade de times. Sem transição, a troca lê-se como
          "a página recarregou", e o olho perde onde estava. */}
      {loading ? (
        <div className="muted">Carregando…</div>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -10, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {view === "people" ? (
              <>
                {criando && (
                  <NewMember
                    team={team}
                    teams={teams}
                    scope={scope}
                    isAdmin={isAdmin}
                    onCancel={() => setCriando(false)}
                    onCreated={async (r, texto) => {
                      setRevelado(r);
                      setCriando(false);
                      setAviso(texto);
                      await carregar();
                    }}
                  />
                )}

                {/* ---- A BUSCA ---------------------------------------------
                    ⚠️ ELA VALE NOS TRÊS NÍVEIS. Nasceu na organização, onde
                    "onde está a Fulana?" não tem outra resposta; mas numa área
                    com dezenas de pessoas a pergunta é a mesma. Deixá-la só num
                    nível seria a divergência que esta unificação veio matar. */}
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
                    {/* ---- AS ABAS DE ESTADO ------------------------------
                        ⚠️ A contagem fica NA ABA, e não só no cabeçalho: é ela
                        que responde "quem ainda não entrou?" antes do clique.
                        ⚠️ E `0` aparece — `count: 0` mostra "0", ao contrário
                        de `undefined`. Uma aba sem número lê-se como "não sei". */}
                    <div className="mb-3">
                      <Tabs
                        aria-label="Estado das pessoas"
                        group="estado"
                        active={tab}
                        onSelect={setTab}
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
                        transition={{ duration: 0.18 }}
                      >
                        {visiveis.length === 0 ? (
                          <div className="muted rounded-lg border border-border bg-surface p-4 text-sm">
                            {emptyStateText(tab)}
                          </div>
                        ) : (
                          <MembersTable
                            rows={visiveis}
                            teams={teams}
                            me={me}
                            middleColumn={middleColumn(naOrganizacao, teams)}
                            count={`${visiveis.length} de ${rows.length} pessoas`}
                            onChanged={async (texto) => {
                              setAviso(texto);
                              await carregar();
                            }}
                          />
                        )}
                      </motion.div>
                    </AnimatePresence>
                  </>
                )}
              </>
            ) : (
              <>
                {criando && (
                  <NewTeam
                    parent={team}
                    nivel={nomeDoNivelDeBaixo}
                    onCancel={() => setCriando(false)}
                    onCreated={async (texto) => {
                      setCriando(false);
                      setAviso(texto);
                      await carregar();
                    }}
                  />
                )}

                {cards.length === 0 ? (
                  <div className="muted">
                    Nenhuma {nomeDoNivelDeBaixo} aqui ainda.
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {cards.map((c) => (
                      <div
                        key={c.team.id}
                        className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
                      >
                        <div className="flex items-center gap-2">
                          {/* ⚠️ O NOME É LINK, e o lápis abre a gaveta: são
                              duas intenções diferentes -- "entrar" e "editar
                              isto" -- e o mesmo clique para as duas obrigaria
                              a escolher uma. */}
                          <Link
                            href={`/times/${c.team.id}`}
                            className="min-w-0 flex-1 truncate font-semibold hover:underline"
                          >
                            {c.team.name}
                          </Link>
                          <button
                            className="btn btn-ghost"
                            aria-label={`Editar ${c.team.name}`}
                            onClick={() => setGavetaDeTime(c.team)}
                          >
                            <Pencil size={14} aria-hidden="true" />
                          </button>
                        </div>
                        <div className="muted text-xs">
                          {c.pessoas} {c.pessoas === 1 ? "pessoa" : "pessoas"}
                          {c.subteams > 0 &&
                            ` · ${c.subteams} ${
                              c.subteams === 1 ? "subtime" : "subtimes"
                            }`}
                        </div>
                      </div>
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
            onClose={() => setGavetaDeTime(null)}
            onChanged={async (texto) => {
              setGavetaDeTime(null);
              setAviso(texto);
              await carregar();
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * A coluna do meio: o que ela mostra depende do NÍVEL.
 *
 * ⚠️ Na organização não existe "cargo aqui" — não há um "aqui". O que
 * responde a mesma pergunta ("de onde essa pessoa é?") são as ÁREAS dela.
 */
function middleColumn(naOrganizacao: boolean, teams: Team[]) {
  if (!naOrganizacao) {
    return {
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
  }
  return {
    title: "Áreas",
    render: (r: { member: Member }) => {
      const areas = (r.member.area_ids ?? [])
        .map((id) => teams.find((t) => t.id === id))
        .filter((t): t is Team => t !== undefined);
      return areas.length === 0 ? (
        <Badge tone="outline" size="sm">
          Sem área
        </Badge>
      ) : (
        <span className="flex flex-wrap gap-1.5">
          {areas.map((a) => (
            <Badge key={a.id} tone="neutral" size="sm" className="border">
              {a.name}
            </Badge>
          ))}
        </span>
      );
    },
  };
}

/**
 * O vazio de cada aba diz POR QUE está vazio.
 *
 * ⚠️ "Nenhum resultado" numa aba filtrada é a mensagem que faz a pessoa achar
 * que perdeu registros — o mesmo mal-estar do defeito de contador de 27/07,
 * numa forma mais barata.
 */
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

/**
 * Cadastrar pessoa nova.
 *
 * ⚠️ COM `team`, o time já está decidido — é a tela em que se está. SEM ele
 * (na organização), a pessoa escolhe: não existe um "aqui" para entrar, e o
 * backend exige um time no cadastro.
 */
function NewMember({
  team,
  teams,
  scope,
  isAdmin,
  onCancel,
  onCreated,
}: {
  team: Team | null;
  teams: Team[];
  scope: Alcance;
  isAdmin: boolean;
  onCancel: () => void;
  onCreated: (revealed: RevealedPassword, aviso: string) => Promise<void>;
}) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [timeEscolhido, setTimeEscolhido] = useState(team?.id ?? "");
  const alvo = teams.find((t) => t.id === timeEscolhido) ?? null;

  // ⚠️⚠️ AS OPÇÕES VÊM DE `papeisAtribuiveis`, COM O NÍVEL DO TIME ALVO. É o
  // formulário que mais custa errar: escolher um papel impossível, preencher
  // nome e e-mail e só então levar 409 é a forma mais cara de descobrir a
  // regra. Numa área não cabe SUPERVISOR; num subtime não cabe MANAGER.
  //
  // ⚠️ Sem time escolhido não há nível — e a lista vazia é o estado honesto.
  const opcoes = alvo
    ? papeisAtribuiveis(scope, isAdmin, alvo.parent_team_id === null)
    : [];
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
        {team === null && (
          <div className="field min-w-[200px] flex-1">
            <span className="label">Time</span>
            <select
              className="input"
              value={timeEscolhido}
              disabled={salvando}
              onChange={(e) => {
                setTimeEscolhido(e.target.value);
                // ⚠️ LIMPA O PAPEL ao trocar de time: o que cabe muda com o
                // nível, e um papel escolhido para uma área pode não existir
                // no subtime seguinte. Guardá-lo mandaria ao servidor uma
                // combinação que ele recusa com 409.
                setPapel("");
              }}
            >
              <option value="">— selecione o time —</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.parent_team_id === null ? `${t.name} (área)` : t.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field min-w-[180px] flex-1">
          <span className="label">
            {alvo ? `Cargo em ${alvo.name}` : "Cargo"}
          </span>
          <select
            className="input"
            value={papel}
            disabled={salvando || opcoes.length === 0}
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
            if (!alvo || papel === "") return;
            setSalvando(true);
            setErro(null);
            try {
              const novo = await createMember({
                name: nome.trim(),
                email: email.trim(),
                teamId: alvo.id,
                role: papel,
              });
              await onCreated(
                {
                  title: `Membro cadastrado: ${novo.name}`,
                  email: novo.email,
                  password: novo.temporary_password,
                },
                `${novo.name} entrou em ${alvo.name} como ${ROLE_LABEL[
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

/**
 * Criar o nível de baixo: um SUBTIME dentro do time aberto, ou uma ÁREA quando
 * o recorte é a organização.
 *
 * ⚠️ `parent` NULO CRIA ÁREA, e é o backend que define isso: `parent_team_id`
 * ausente (ou `null`) = raiz. E `""` NÃO SERVE como "sem pai" — a rota tipa
 * `uuid | None`, então string vazia é 422. A primeira versão da tela de
 * organização mandava `""` e o `tsc` não acusou, porque `""` É uma `string`.
 */
function NewTeam({
  parent,
  nivel,
  onCancel,
  onCreated,
}: {
  parent: Team | null;
  nivel: string;
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
            // ⚠️ Sugere o identificador enquanto a pessoa não o editar à mão.
            // O backend só aceita `^[a-z0-9-]+$`; sem isto, digitar "CRM e
            // Automação" devolveria 422 e ela teria de adivinhar a regra.
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
        {parent ? (
          <>
            Vai ficar dentro de <strong>{parent.name}</strong>.
          </>
        ) : (
          "Área nova, no topo da organização."
        )}
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
                parent_team_id: parent ? parent.id : null,
              });
              await onCreated(
                parent
                  ? `${nome.trim()} criado dentro de ${parent.name}.`
                  : `Área ${nome.trim()} criada.`,
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
          {salvando ? "Criando…" : `Criar ${nivel}`}
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
