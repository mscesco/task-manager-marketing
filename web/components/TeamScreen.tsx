"use client";
// components/TeamScreen.tsx
// A tela de pessoas e estrutura — Spec 047; unificada em 09/09.
//
// ⚠️⚠️ ESTA É A ÚNICA TELA DE PESSOAS DO PRODUTO. Havia uma segunda,
// `/membros`, com estrutura própria — sem alternador, sem a visão de subtimes
// — e a Camila resolveu em 09/09: *"adorei a tela que tava com o título
// 'marketing área' (…) aquela tela é a que eu quero que mostre quando eu
// abrisse o membros"*. A rota `/membros` deixou de existir; a entrada de menu
// virou "Time" e leva à área da pessoa.
//
// ⚠️ E ISSO NÃO É ECONOMIA DE CÓDIGO, é a §5 da spec: *"duas telas listando
// pessoas, com regras diferentes, é o começo do próximo defeito de contador"*.
// As duas já dividiam a TABELA; o que divergia era tudo em volta, e ia
// divergir de novo na próxima mudança.
//
// ⚠️ EU JÁ ERREI ISTO UMA VEZ, e vale ficar escrito: em vez de mandar
// `/membros` para a tela do time, inventei aqui um terceiro nível
// ("organização", com `teamId = null`) que ninguém pediu — e que duplicava a
// `/organizacao`. Ela desfez: a tela é do TIME, e o menu é um atalho.
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
import { ArrowLeft, Pencil, Search } from "lucide-react";
import Tabs from "@/components/Tabs";
import Toggle from "@/components/Toggle";
import Badge from "@/components/Badge";
import Card from "@/components/Card";
import PageHeader from "@/components/PageHeader";
import Reveal from "@/components/Reveal";
import Toasts, { useToasts } from "@/components/Toasts";
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
import { matchesSearch } from "@/lib/organization";
import { countByState, memberState, type MemberState } from "@/lib/memberState";
import { sugereSlug } from "@/lib/gestaoTimes";
import {
  alcanceDe,
  papeisAtribuiveis,
  podeCadastrarMembro,
  podeMoverSubtime,
  temAcaoPossivel,
  type Alcance,
} from "@/lib/permissoesMembros";
import { lerEstadoDaTela, gravarEstadoDaTela } from "@/lib/estadoDaTela";

type View = "people" | "structure";
type RevealedPassword = { title: string; email: string; password: string };

export default function TeamScreen({ teamId }: { teamId: string }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  // ⚠️ Os avisos viraram uma PILHA no canto (`Toasts`). O aviso inline
  // empurrava a tela para baixo justamente quando a pessoa olhava para a
  // linha que acabou de mudar.
  const { toasts, avisar, dispensar } = useToasts();

  // ⚠️⚠️ O ESTADO DA TELA MORA NA URL, e não só em `useState`: *"se eu
  // recarrego a tela, ela não lembra onde eu estava"*. Na URL ele sobrevive ao
  // F5 E vira link — mandar "olha os inativos do Marketing" passa a ser
  // possível, o que estado em memória nunca daria.
  const inicial = lerEstadoDaTela();
  const [view, setView] = useState<View>(inicial.view);
  const [tab, setTab] = useState<MemberState>(inicial.tab);
  const [busca, setBusca] = useState("");
  const [criando, setCriando] = useState(false);
  const [revelado, setRevelado] = useState<RevealedPassword | null>(null);
  const [gavetaDeTime, setGavetaDeTime] = useState<Team | null>(null);
  // ⚠️⚠️ A GAVETA DA PESSOA MORA AQUI, e não na tabela. Ela era da tabela,
  // e por isso só existia para quem vinha da tabela: da gaveta do SUBTIME,
  // que lista as mesmas pessoas com o cargo, não havia caminho nenhum -- a
  // Camila tentou trocar a permissão ali e não conseguiu (09/09). Com a tela
  // como dona, as duas portas entregam a MESMA gaveta.
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

  const rows = useMemo(
    () => teamRows(teamId, teams, members),
    [teamId, teams, members],
  );

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

  const ehArea = team?.parent_team_id === null;
  // ⚠️⚠️ O CAMINHO DE VOLTA, pedido dela em 10/09: *"essa tela de subtime
  // precisa de algum botão pra voltar"*. E ela chegou nesta tela por um CARTÃO
  // -- não há "voltar" óbvio quando a navegação foi para dentro.
  //
  // ⚠️ SOBE UM NÍVEL, e não usa o histórico do navegador: `history.back()`
  // levaria para onde a pessoa VEIO, que pode ser o quadro, a busca, ou nada
  // (aba nova). Um link para o PAI é sempre o mesmo lugar, e é o que a
  // hierarquia promete. Numa ÁREA ele não aparece: não há acima.
  const pai = team?.parent_team_id
    ? teams.find((t) => t.id === team.parent_team_id) ?? null
    : null;

  const podeAgir =
    view === "people" ? podeCadastrarMembro(scope) : podeMexerEmTimes;

  return (
    <>
      {pai && (
        <a
          href={`/times/${pai.id}`}
          className="muted mb-2 inline-flex items-center gap-1.5 text-xs hover:text-accent"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          {pai.name}
        </a>
      )}

      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            {team ? team.name : "Time"}
            {/* ⚠️ Diz o NÍVEL, porque a tela é a mesma para os dois e o
                conteúdo muda: numa área aparece a árvore inteira; num
                subtime, só ele e o que está abaixo. */}
            {team && (
              <Badge tone="outline" size="sm">
                {ehArea ? "Área" : "Subtime"}
              </Badge>
            )}
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
            gravarEstadoDaTela({ view: v, tab });
            // ⚠️ Fecha o formulário ao virar a chave: ele pertence ao assunto
            // anterior, e deixá-lo aberto criaria uma área a partir de um
            // formulário que a pessoa abriu para cadastrar gente.
            setCriando(false);
          }}
          sides={[
            { id: "people", label: "Membros", count: rows.length },
            { id: "structure", label: "Subtimes", count: cards.length },
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
                {/* ⚠️ `Reveal` e não `{criando && …}`: o formulário empurra a
                    tabela para baixo, e sem transição a lista SALTA. */}
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
                        transition={{ duration: 0.18 }}
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
                            // ⚠️⚠️ SÓ PARA QUEM TEM O QUE FAZER LÁ DENTRO:
                            // *"Rafael é só operator e ainda tem a opção de
                            // editar o membro, mesmo não podendo fazer nada na
                            // tela, tem algum propósito?"*. Não tinha. A
                            // pergunta é `temAcaoPossivel`, que já existe e é
                            // testada -- e é POR LINHA, porque um supervisor
                            // alcança uns e não outros.
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
                        canManage={podeMexerEmTimes}
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
            onClose={() => setGavetaDeTime(null)}
            onChanged={async (texto) => {
              setGavetaDeTime(null);
              avisar(texto);
              await carregar();
            }}
            // ⚠️⚠️ RECARREGA SEM FECHAR. Adicionar gente é operação em SÉRIE, e
            // fechar a gaveta a cada uma obrigava a reabrir o time -- foi o que
            // ela relatou em 09/09. O `carregar()` traz a lista nova, e a
            // `AnimatePresence` de lá faz a linha entrar deslizando.
            onRefresh={carregar}
          />
        )}
      </AnimatePresence>

      {/* ⚠️ A GAVETA DESENHA A PRÓPRIA senha provisória, desde 09/09 -- o
          bloco azul aparecia aqui, ATRÁS dela. O `revelado` desta tela agora
          serve só ao CADASTRO, que acontece sem gaveta nenhuma aberta. */}
      <AnimatePresence>
        {gavetaDePessoa && (
          <MemberDrawer
            key={gavetaDePessoa.id}
            member={gavetaDePessoa}
            teams={teams}
            scope={scope}
            isAdmin={isAdmin}
            canManageOrg={
              me?.permissions.includes("workspace.manage") ?? false
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

      <Toasts toasts={toasts} onDismiss={dispensar} />
    </>
  );
}

/**
 * A coluna do meio da tabela.
 *
 * ⚠️ É uma CONSTANTE, e não uma função de nível: a tabela é compartilhada com
 * outra tela (`MembersTable` recebe `middleColumn` como parâmetro justamente
 * por isso), mas aqui o recorte é sempre um time — então o que ela responde é
 * sempre a mesma pergunta: *que cargo esta pessoa tem NESTE time?*
 */
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
 * Cadastrar pessoa nova, já NESTE time.
 *
 * ⚠️ NÃO HÁ SELETOR DE TIME AQUI, e a ausência é a tela toda: o time é aquele
 * em que se está. Um `<select>` de time neste formulário significaria que a
 * tela não sabe do que fala — foi o que a versão com nível de "organização"
 * precisava, e ela não existe mais.
 */
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

  // ⚠️⚠️ AS OPÇÕES VÊM DE `papeisAtribuiveis`, COM O NÍVEL DESTE TIME. É o
  // formulário que mais custa errar: escolher um papel impossível, preencher
  // nome e e-mail e só então levar 409 é a forma mais cara de descobrir a
  // regra. Numa área não cabe SUPERVISOR; num subtime não cabe MANAGER.
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

/**
 * Criar um SUBTIME dentro do time aberto.
 *
 * ⚠️ CRIAR ÁREA NÃO MORA AQUI: área é raiz, e criar raiz é ato de organização
 * (`area.create`, que só os papéis de organização têm — Spec 046 §4.1). O
 * lugar dela é a `/organizacao`.
 */
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
