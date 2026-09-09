"use client";
// app/times/[id]/page.tsx
// A tela de UM TIME — Spec 047, fatia C; redesenhada em 09/09.
//
// A divisão de hoje, e vale ter em mente ao mexer aqui:
//
//     o alternador   escolhe o ASSUNTO   (pessoas ou estrutura)
//     as abas        escolhem o RECORTE  (ativos, convidados, inativos)
//     o lápis        abre a GAVETA       (a única porta de edição)
//
// ⚠️⚠️ O ALTERNADOR EXISTE PORQUE A TELA TINHA DOIS ASSUNTOS E MOSTRAVA UM SÓ.
// "Quem está aqui" e "o que tem dentro daqui" são as duas perguntas de quem
// administra um time, e a segunda vivia noutra tela (`/times`, a árvore do
// workspace inteiro) — longe do contexto em que ela é feita.
//
// ⚠️ E O BOTÃO DE AÇÃO SEGUE O ALTERNADOR, por decisão da Camila: *"o botão de
// novo membro muda de acordo com o toggle"*. Dois botões fixos, um deles
// sempre fora de assunto, é o que a troca evita.
//
// ⚠️ UMA TELA SÓ PARA ÁREA E SUBTIME, e a decisão é explícita: gerir uma área
// e gerir um subtime são públicos diferentes, mas duas telas divergem com o
// tempo — e separar depois é mais fácil do que reunificar.
//
// ⚠️ TODA DECISÃO MORA EM `lib/telaDoTime.ts` e `lib/estadoDoMembro.ts`,
// testadas. `app/` está fora do `include` do vitest, e nesta tela isso é
// crítico: as regras mais delicadas (quem aparece, quem é "convidado") são
// justamente as que não dão erro quando saem erradas.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Pencil } from "lucide-react";
import AppShell from "@/components/AppShell";
import Abas from "@/components/Abas";
import Badge from "@/components/Badge";
import Card from "@/components/Card";
import PageHeader from "@/components/PageHeader";
import SenhaProvisoria from "@/components/SenhaProvisoria";
import SidebarDoSubtime from "@/components/SidebarDoSubtime";
import TabelaDeMembros, { PAPEL } from "@/components/TabelaDeMembros";
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
import { cartoesDeSubtime, linhasDoTime } from "@/lib/telaDoTime";
import {
  contagemPorEstado,
  estadoDoMembro,
  type EstadoDoMembro,
} from "@/lib/estadoDoMembro";
import { sugereSlug } from "@/lib/gestaoTimes";
import {
  alcanceDe,
  papeisAtribuiveis,
  podeCadastrarMembro,
  podeMoverSubtime,
} from "@/lib/permissoesMembros";

type Visao = "membros" | "subtimes";
type Revelado = { titulo: string; email: string; senha: string };

export default function TimePage() {
  const params = useParams<{ id: string }>();
  const teamId = params.id;

  const [times, setTimes] = useState<Team[]>([]);
  const [membros, setMembros] = useState<Member[]>([]);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [visao, setVisao] = useState<Visao>("membros");
  const [aba, setAba] = useState<EstadoDoMembro>("ativo");
  const [criando, setCriando] = useState(false);
  const [revelado, setRevelado] = useState<Revelado | null>(null);
  const [subtimeAberto, setSubtimeAberto] = useState<Team | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [t, m, u] = await Promise.all([
        listTeamsAll(),
        listMembers(),
        currentUser(),
      ]);
      setTimes(t);
      setMembros(m);
      setMe(u);
      setErro(null);
    } catch (e) {
      setErro((e as ApiError).message || "Não consegui carregar o time.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const time = times.find((t) => t.id === teamId) ?? null;
  const linhas = useMemo(
    () => linhasDoTime(teamId, times, membros),
    [teamId, times, membros],
  );
  const cartoes = useMemo(
    () => cartoesDeSubtime(teamId, times, membros),
    [teamId, times, membros],
  );

  // ⚠️ A CONTAGEM É SOBRE QUEM ESTÁ NESTA ÁRVORE, e não sobre a organização:
  // as abas recortam o que a tabela desta tela mostra.
  const contagem = useMemo(
    () => contagemPorEstado(linhas.map((l) => l.membro)),
    [linhas],
  );
  const linhasVisiveis = useMemo(
    () => linhas.filter((l) => estadoDoMembro(l.membro) === aba),
    [linhas, aba],
  );

  const alcance = alcanceDe(me);
  const podeMexerEmTimes = podeMoverSubtime(alcance);
  const souAdmin = me?.roles.includes("ADMIN") ?? false;

  if (!carregando && !time) {
    return (
      <AppShell>
        <div className="muted">
          Time não encontrado. Volte para a{" "}
          <Link href="/organizacao" className="text-accent underline">
            organização
          </Link>
          .
        </div>
      </AppShell>
    );
  }

  const ehArea = time?.parent_team_id === null;

  // ⚠️ O BOTÃO DE AÇÃO MUDA COM O ALTERNADOR (pedido da Camila em 09/09), e a
  // permissão de cada um é diferente: cadastrar pessoa dispara senha
  // provisória e é do gestor (D3 da Spec 028); criar subtime é gestão de
  // estrutura. Um botão só, com a pergunta certa para o assunto na tela.
  const podeAgir =
    visao === "membros" ? podeCadastrarMembro(alcance) : podeMexerEmTimes;

  return (
    <AppShell>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            {time ? time.name : "Time"}
            {time && (
              // ⚠️ Diz o NÍVEL, porque a tela é a mesma para os dois e o
              // conteúdo muda: numa área aparece todo mundo da árvore; num
              // subtime, só quem está nele e abaixo.
              <Badge tone="outline" size="sm">
                {ehArea ? "Área" : "Subtime"}
              </Badge>
            )}
          </span>
        }
        actions={
          podeAgir &&
          !criando && (
            <button
              className="btn btn-primary ml-auto"
              style={{ padding: "8px 14px" }}
              onClick={() => setCriando(true)}
            >
              {visao === "membros" ? "+ Novo membro" : "+ Novo subtime"}
            </button>
          )
        }
      />

      {erro && <div className="error-box">{erro}</div>}

      {aviso && (
        <div role="status" className="muted mb-4 flex items-start gap-2 text-xs">
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
        <SenhaProvisoria
          titulo={revelado.titulo}
          email={revelado.email}
          senha={revelado.senha}
          onFechar={() => setRevelado(null)}
        />
      )}

      {/* ---- O ALTERNADOR ------------------------------------------------
          ⚠️ `Abas` outra vez, com `grupo` PRÓPRIO: o `layoutId` do motion é
          global, e dois grupos com o mesmo id fariam o indicador voar de um
          para o outro ao trocar de aba. */}
      <div className="mb-4">
        <Abas
          aria-label="O que ver neste time"
          grupo="visao"
          ativa={visao}
          onEscolher={(v) => {
            setVisao(v);
            // ⚠️ Fecha o formulário ao virar a chave: ele pertence ao assunto
            // anterior, e deixá-lo aberto criaria um subtime a partir de um
            // formulário que a pessoa abriu para cadastrar gente.
            setCriando(false);
          }}
          abas={[
            { id: "membros", rotulo: "Membros", contagem: linhas.length },
            { id: "subtimes", rotulo: "Subtimes", contagem: cartoes.length },
          ]}
        />
      </div>

      {carregando ? (
        <div className="muted">Carregando…</div>
      ) : visao === "membros" ? (
        <>
          {criando && time && (
            <NovoMembro
              time={time}
              alcance={alcance}
              souAdmin={souAdmin}
              onCancelar={() => setCriando(false)}
              onCriado={async (r, texto) => {
                setRevelado(r);
                setCriando(false);
                setAviso(texto);
                await carregar();
              }}
            />
          )}

          {linhas.length === 0 ? (
            <div className="muted">Ninguém neste time ainda.</div>
          ) : (
            <>
              {/* ---- AS ABAS DE ESTADO --------------------------------
                  ⚠️ A contagem fica NA ABA, e não só no cabeçalho: é ela que
                  responde "quem ainda não entrou?" antes mesmo do clique.
                  ⚠️ E `0` aparece — `contagem: 0` mostra "0", ao contrário de
                  `undefined`. Uma aba sem número lê-se como "não sei". */}
              <div className="mb-3">
                <Abas
                  aria-label="Estado das pessoas"
                  grupo="estado"
                  ativa={aba}
                  onEscolher={setAba}
                  abas={[
                    { id: "ativo", rotulo: "Ativos", contagem: contagem.ativo },
                    {
                      id: "convidado",
                      rotulo: "Convidados",
                      contagem: contagem.convidado,
                    },
                    {
                      id: "inativo",
                      rotulo: "Inativos",
                      contagem: contagem.inativo,
                    },
                  ]}
                />
              </div>

              {/* ⚠️ A TROCA DE ABA É ANIMADA (pedido dela: *"pra aba que vem
                  também, adicionar alguma animação para deixar mais fluida"*).
                  `key={aba}` é o que faz o React trocar o nó -- sem isso o
                  motion vê o mesmo elemento e não há entrada nenhuma.
                  ⚠️ `mode="wait"` evita as duas listas empilhadas por um
                  instante, que numa TABELA salta aos olhos. */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={aba}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                >
                  {linhasVisiveis.length === 0 ? (
                    <div className="muted rounded-lg border border-border bg-surface p-4 text-sm">
                      {vazioDaAba(aba)}
                    </div>
                  ) : (
                    <TabelaDeMembros
                      linhas={linhasVisiveis}
                      times={times}
                      me={me}
                      colunaDoMeio={{
                        titulo: "Cargo aqui",
                        render: (l) =>
                          l.cargoAqui ? (
                            <Badge tone="neutral" size="sm" className="border">
                              {PAPEL[l.cargoAqui]}
                            </Badge>
                          ) : (
                            <span className="muted text-xs">—</span>
                          ),
                      }}
                      // ⚠️ "N de M", nunca só N. A §3.2: o defeito de 27/07 foi
                      // o cabeçalho divergindo do corpo, e mostrar só o
                      // filtrado apaga a informação de que existe mais.
                      contagem={`${linhasVisiveis.length} de ${linhas.length} pessoas`}
                      onMudou={async (texto) => {
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
          {criando && time && (
            <NovoSubtime
              pai={time}
              onCancelar={() => setCriando(false)}
              onCriado={async (texto) => {
                setCriando(false);
                setAviso(texto);
                await carregar();
              }}
            />
          )}

          {cartoes.length === 0 ? (
            <div className="muted">
              Nenhum subtime dentro de {time?.name}.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {cartoes.map((c) => (
                <div
                  key={c.team.id}
                  className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
                >
                  <div className="flex items-start gap-2">
                    {/* ⚠️ O NOME É LINK, e o lápis abre a gaveta: são duas
                        intenções diferentes -- "entrar no subtime" e "editar
                        este subtime" -- e o mesmo clique para as duas obrigaria
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
                      onClick={() => setSubtimeAberto(c.team)}
                    >
                      <Pencil size={14} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="muted text-xs">
                    {c.pessoas} {c.pessoas === 1 ? "pessoa" : "pessoas"}
                    {c.subtimes > 0 &&
                      ` · ${c.subtimes} ${
                        c.subtimes === 1 ? "subtime" : "subtimes"
                      }`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <AnimatePresence>
        {subtimeAberto && (
          <SidebarDoSubtime
            key={subtimeAberto.id}
            time={subtimeAberto}
            membros={membros}
            souAdmin={souAdmin}
            podeMexer={podeMexerEmTimes}
            onFechar={() => setSubtimeAberto(null)}
            onMudou={async (texto) => {
              setSubtimeAberto(null);
              setAviso(texto);
              await carregar();
            }}
          />
        )}
      </AnimatePresence>
    </AppShell>
  );
}

/**
 * O vazio de cada aba diz POR QUE está vazio.
 *
 * ⚠️ "Nenhum resultado" numa aba filtrada é a mensagem que faz a pessoa achar
 * que perdeu registros — o mesmo mal-estar do defeito de contador de 27/07,
 * numa forma mais barata.
 */
function vazioDaAba(aba: EstadoDoMembro): string {
  switch (aba) {
    case "ativo":
      return "Ninguém ativo aqui — veja as outras abas.";
    case "convidado":
      return "Ninguém pendente: todo mundo já entrou pelo menos uma vez.";
    case "inativo":
      return "Ninguém desativado neste time.";
  }
}

/** Cadastrar pessoa nova, já neste time. */
function NovoMembro({
  time,
  alcance,
  souAdmin,
  onCancelar,
  onCriado,
}: {
  time: Team;
  alcance: ReturnType<typeof alcanceDe>;
  souAdmin: boolean;
  onCancelar: () => void;
  onCriado: (revelado: Revelado, aviso: string) => Promise<void>;
}) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  // ⚠️⚠️ AS OPÇÕES VÊM DE `papeisAtribuiveis`, COM O NÍVEL DESTE TIME. É o
  // formulário que mais custa errar: escolher um papel impossível, preencher
  // nome e e-mail e só então levar 409 é a forma mais cara de descobrir a
  // regra. Numa área não cabe SUPERVISOR; num subtime não cabe MANAGER.
  const opcoes = papeisAtribuiveis(
    alcance,
    souAdmin,
    time.parent_team_id === null,
  );
  const [papel, setPapel] = useState<MemberRole>(opcoes[opcoes.length - 1]);
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
      <div className="field max-w-[220px]">
        <span className="label">Cargo em {time.name}</span>
        <select
          className="input"
          value={papel}
          disabled={salvando}
          onChange={(e) => setPapel(e.target.value as MemberRole)}
        >
          {opcoes.map((p) => (
            <option key={p} value={p}>
              {PAPEL[p]}
            </option>
          ))}
        </select>
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
          disabled={salvando || !nome.trim() || !email.trim()}
          onClick={async () => {
            setSalvando(true);
            setErro(null);
            try {
              const novo = await createMember({
                name: nome.trim(),
                email: email.trim(),
                teamId: time.id,
                role: papel,
              });
              await onCriado(
                {
                  titulo: `Membro cadastrado: ${novo.name}`,
                  email: novo.email,
                  senha: novo.temporary_password,
                },
                `${novo.name} entrou em ${time.name} como ${PAPEL[
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
          onClick={onCancelar}
        >
          Cancelar
        </button>
      </div>
    </Card>
  );
}

/** Criar um subtime DENTRO do time aberto. */
function NovoSubtime({
  pai,
  onCancelar,
  onCriado,
}: {
  pai: Team;
  onCancelar: () => void;
  onCriado: (aviso: string) => Promise<void>;
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
        Vai ficar dentro de <strong>{pai.name}</strong>.
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
                parent_team_id: pai.id,
              });
              await onCriado(`${nome.trim()} criado dentro de ${pai.name}.`);
            } catch (e) {
              const a = e as ApiError;
              setErro(
                a.status === 403
                  ? "Você não tem permissão para criar times."
                  : a.status === 409
                  ? "Já existe um time com esse identificador."
                  : a.status === 422
                  ? "Identificador inválido: use só letras minúsculas, números e hífen."
                  : a.message || "Não consegui criar o subtime.",
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
          onClick={onCancelar}
        >
          Cancelar
        </button>
      </div>
    </Card>
  );
}
