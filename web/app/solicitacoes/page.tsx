"use client";
// /solicitacoes — fila de triagem agrupada por ENVIO.
//
// UMA LINHA POR SUBMISSÃO, não por demanda: quem preenche o formulário
// escolhendo 4 categorias gerava 4 cards soltos, e ninguém enxergava que
// eram da mesma pessoa.
//
// ⚠️ CAIXA DE ENTRADA EM DUAS COLUNAS DESDE 15/10 (proposta aprovada por ela,
// "fica bem melhor"; depois "quero algo mais bonito, mais dinâmico", com uma
// referência de inbox): a lista de envios à esquerda e o envio escolhido à
// direita. O card que abria e fechava fazia a página pular, e aprovar exigia
// abrir, achar a seção e voltar. Os números no código (1 a 5) são os da
// proposta.
//
// ⚠️ AS ANIMAÇÕES SÃO SÓ DE `transform` E `opacity` (§7 do `web/AGENTS.md`),
// e o `MotionConfig reducedMotion="user"` as desliga para quem pediu menos
// movimento no sistema -- o bloco global do CSS não alcança o `motion`.
//
// A aprovação continua sendo POR SEÇÃO (aprovar a arte, rejeitar a
// divulgação). O agrupamento é só de visualização.
//
// "Tarefa criada" é autodeclarado — ninguém verifica. O valor está no
// contrário: o filtro "só sem tarefa" mostra o que foi aceito e nunca virou
// tarefa. Sem esse filtro, a marcação seria decorativa.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronDown,
  Clock,
  Copy,
  FileText,
  Hash,
  Inbox,
  Mail,
  MapPin,
  Phone,
  Search,
  SquareCheckBig,
  X,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import Avatar from "@/components/Avatar";
import Badge from "@/components/Badge";
import EmptyState from "@/components/EmptyState";
import PageHeader from "@/components/PageHeader";
import Link from "next/link";
import {
  andarSolicitacao,
  aprovarSolicitacao,
  criarTarefaDaSolicitacao,
  listarEnvios,
  marcarTarefaCriada,
  rejeitarSolicitacao,
  ApiError,
  type Batch,
  type BatchItem,
  type FilaAba,
  type SolicitacaoFiltro,
  type SolicitacaoStatus,
  STATUS_ACEITOS,
} from "@/lib/api";
import { numeroDaRepeticao, rotuloDaCategoria } from "@/lib/rotuloDaCategoria";
import { demandaInicial, diaDoEnvio, quandoChegou } from "@/lib/filaDeSolicitacoes";

import Loading from "@/components/Loading";
import { useActiveTeam, useActiveTeamId } from "@/lib/useActiveTeam";
import { navHref } from "@/lib/activeTeam";
import Paginacao from "@/components/Paginacao";
import AnchoredPanel, { useAnchoredPanel } from "@/components/AnchoredPanel";

const STATUS_LABEL: Record<SolicitacaoStatus, string> = {
  PENDING: "Pendente",
  APPROVED: "Aprovada",
  IN_PROGRESS: "Em andamento",
  DONE: "Concluída",
  REJECTED: "Rejeitada",
};
// ⚠️ AZUL PARA "EM ANDAMENTO" E VERDE-ESCURO PARA "CONCLUÍDA", e não dois
// verdes: "aprovada" e "concluída" são estados distantes no fluxo e precisam
// se distinguir de relance numa lista. O `Badge tone="soft"` aplica a tinta,
// e estas cores são as mesmas famílias já medidas para AA no tema claro e
// escuro (Spec 031 §2.2b).
const STATUS_COLOR: Record<SolicitacaoStatus, string> = {
  PENDING: "#d97706",
  APPROVED: "#16a34a",
  IN_PROGRESS: "#2563eb",
  DONE: "#15803d",
  REJECTED: "#dc2626",
};

/** A mola de toda a tela: rápida, quase sem quique. */
const MOLA = { type: "spring", duration: 0.32, bounce: 0.12 } as const;

// ⚠️ AS ABAS (15/10, proposta aprovada por ela): eram sete botões iguais aos
// de ação, com número em só dois, e "Aprovadas" e "Aprovadas sem tarefa" se
// sobrepondo. Agora são cinco situações, todas com número, e "só sem tarefa"
// é uma caixinha que vale em qualquer aba onde faz sentido.
type Aba = "PENDING" | "ACTIVE" | "DONE" | "REJECTED" | "ALL";

const ABAS: { valor: Aba; label: string; semTarefa: boolean }[] = [
  { valor: "PENDING", label: "Pendentes", semTarefa: false },
  { valor: "ACTIVE", label: "Em andamento", semTarefa: true },
  { valor: "DONE", label: "Concluídas", semTarefa: true },
  { valor: "REJECTED", label: "Rejeitadas", semTarefa: false },
  { valor: "ALL", label: "Todas", semTarefa: true },
];

// A lista ficou enxuta (as respostas moram no painel ao lado), então cabem
// mais envios por página do que os dez do card antigo.
const TAMANHO_PAGINA = 20;

/** As duas colunas descem juntas e rolam por dentro, como uma caixa de entrada. */
const ALTURA_DO_PAINEL = "md:h-[calc(100vh-170px)] md:min-h-[480px]";

export default function SolicitacoesPage() {
  return (
    <AppShell>
      <MotionConfig reducedMotion="user">
        <Solicitacoes />
      </MotionConfig>
    </AppShell>
  );
}

function Solicitacoes() {
  // ⚠⚠ O TIME ATIVO VEM DA BARRA (Spec 048, fatia C/D), e não de um
  // `useSearchParams` aqui: esta rota é estática e o hook derrubaria o build.
  // Ver `lib/useActiveTeam.tsx`.
  // ⚠⚠ `active === null` (a barra ainda não resolveu) e `kind: "none"` (ela
  // resolveu, e não há time) são COISAS DIFERENTES, e confundi-las deixa a tela
  // em `Loading` para sempre. `listTeamsAll()` no `AppShell` falha em silêncio
  // de propósito (`.catch(() => {})`): sem esta distinção, uma falha de rede
  // ali viraria uma fila que nunca carrega, sem erro nenhum na tela.
  const { active, teamName: nomeDoTime } = useActiveTeam();
  const timeAtivo = useActiveTeamId();
  const [aba, setAba] = useState<Aba>("PENDING");
  const [semTarefa, setSemTarefa] = useState(false);
  const [busca, setBusca] = useState("");
  const [buscaAtiva, setBuscaAtiva] = useState("");
  const [formId, setFormId] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);
  const [envios, setEnvios] = useState<Batch[] | null>(null);
  const [totalEnvios, setTotalEnvios] = useState(0);
  const [totais, setTotais] = useState<Partial<Record<FilaAba, number>>>({});
  const [formularios, setFormularios] = useState<{ id: string; title: string }[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [semAcesso, setSemAcesso] = useState(false);
  // ⚠️ O ENVIO ESCOLHIDO É GUARDADO INTEIRO, e não só o id: aprovar tira o
  // envio da aba "Pendentes", e o painel ao lado sumiria no meio da conversa
  // -- levando o "Abrir a tarefa" que acabou de aparecer. Ele é relido pelo
  // protocolo depois de cada ação (ver `recarregar`).
  const [escolhido, setEscolhido] = useState<Batch | null>(null);
  const [rejeitarItem, setRejeitarItem] = useState<string | null>(null);

  const abaAtual = ABAS.find((a) => a.valor === aba)!;
  const filtrandoSemTarefa = semTarefa && abaAtual.semTarefa;

  // ⚠️ TROCAR DE TIME ZERA O QUE ERA DO TIME ANTERIOR: o envio do painel (que
  // seria de outro time), o formulário escolhido (que não existe neste) e a
  // página. Na renderização, e não num efeito: num efeito a fila buscaria uma
  // vez com o formulário velho e outra sem ele (revisão de 16/10).
  const [timeDaFila, setTimeDaFila] = useState(timeAtivo);
  if (timeDaFila !== timeAtivo) {
    setTimeDaFila(timeAtivo);
    setEscolhido(null);
    setFormId(null);
    setPagina(1);
  }

  // ⚠️ TROCAR DE ABA, BUSCA OU FORMULÁRIO VOLTA À PÁGINA 1 -- a página 3 costuma
  // não existir no recorte novo. No mesmo clique, e não num efeito depois: o
  // efeito buscava duas vezes (página velha, depois a 1), e a que respondesse
  // por último ficava na tela (revisão de 16/10).
  function filtrar(mudar: () => void) {
    mudar();
    setPagina(1);
  }

  // A busca espera a pessoa parar de digitar: uma ida ao servidor por tecla
  // refaria a lista enquanto ela ainda escreve o nome.
  useEffect(() => {
    const t = setTimeout(() => {
      setBuscaAtiva(busca);
      setPagina(1);
    }, 300);
    return () => clearTimeout(t);
  }, [busca]);

  // ⚠️⚠️ SÓ A RESPOSTA DO ÚLTIMO PEDIDO VALE. Trocar de aba com a anterior
  // ainda em voo deixava a resposta atrasada sobrescrever a nova -- a aba
  // "Rejeitadas" marcada, com a lista de "Pendentes" embaixo, e um ✓ que
  // aprovava o que a pessoa achava já ter saído da fila (revisão de 16/10).
  const ultimoPedido = useRef(0);

  const carregar = useCallback(async () => {
    // ⚠⚠ ESPERA O TIME em vez de buscar sem recorte. Buscar antes mostraria a
    // fila da organização inteira por um instante -- e aqui isso é pior que numa
    // lista qualquer: quem tria poderia APROVAR um pedido de outro time no
    // meio do pisca.
    if (active === null) return;
    const meu = ++ultimoPedido.current;
    setErro(null);
    try {
      const r = await listarEnvios({
        ...(aba === "ALL" ? {} : { filtro: aba as SolicitacaoFiltro }),
        page: pagina,
        size: TAMANHO_PAGINA,
        teamId: timeAtivo,
        busca: buscaAtiva,
        formId,
        semTarefa: filtrandoSemTarefa,
      });
      if (meu !== ultimoPedido.current) return;
      // Aprovar o último envio da última página a esvazia: volta para a que
      // ainda existe, em vez de mostrar "nada com este filtro" com envios atrás.
      if (r.items.length === 0 && pagina > 1) {
        setPagina(Math.max(1, Math.ceil(r.total / TAMANHO_PAGINA)));
        return;
      }
      setEnvios(r.items);
      setTotalEnvios(r.total);
      setTotais(r.tab_totals ?? {});
      setFormularios(r.form_options ?? []);
    } catch (err) {
      if (meu !== ultimoPedido.current) return;
      const e = err as ApiError;
      // 403: quem não é admin/manager do time principal não vê a fila.
      // A aba some do menu, mas a URL direta continua alcançável — tratar
      // aqui evita tela quebrada para quem receber o link de alguém.
      if (e.status === 403) {
        setSemAcesso(true);
      } else {
        setErro(e.message || "Não foi possível carregar.");
      }
      setEnvios([]);
    }
    // ⚠️ `timeAtivo` NAS DEPENDÊNCIAS: trocar de time reescreve a query, e sem
    // isto a fila ficaria a mesma com a URL dizendo outro time.
    // ⚠️ `active === null` E NÃO `active`: o objeto é NOVO a cada render da
    // barra, e depender dele refazia o pedido a cada render -- vários pedidos
    // em voo, e o último a responder vencia (defeito de 14/09).
  }, [aba, pagina, timeAtivo, active === null, buscaAtiva, formId, filtrandoSemTarefa]);

  useEffect(() => {
    setEnvios(null);
    carregar();
  }, [carregar]);

  /** Depois de uma ação: a lista, e o envio do painel relido pelo protocolo. */
  async function recarregar() {
    await carregar();
    if (!escolhido) return;
    try {
      const r = await listarEnvios({
        teamId: timeAtivo,
        busca: escolhido.protocol,
        size: 5,
      });
      const novo = r.items.find((b) => b.batch_id === escolhido.batch_id);
      if (novo) setEscolhido(novo);
    } catch {
      /* o painel fica com o que tinha; a lista já mostra o erro, se houver */
    }
  }

  function escolher(envio: Batch, rejeitar: string | null = null) {
    setEscolhido(envio);
    setRejeitarItem(rejeitar);
  }

  if (semAcesso) {
    return (
      <EmptyState
        title="Você não tem acesso às solicitações"
        description="A fila de solicitações é do time principal — apenas administradores e gestores podem visualizá-la. Se você precisa acompanhar uma demanda, fale com o time de marketing."
      />
    );
  }

  const pendentes = totais.PENDING ?? 0;

  return (
    <div>
      <PageHeader
        /* ⚠⚠ O NOME DO TIME NO TÍTULO (fatia D). A §7 da spec previu
           exatamente este risco: *"a fila filtrada pode ficar VAZIA e parecer
           quebrada (...) a tela precisa dizer 'a fila do Marketing está
           vazia', e não mostrar um vazio sem contexto"*. */
        title={nomeDoTime ? `Solicitações · ${nomeDoTime}` : "Solicitações"}
        count={
          pendentes > 0
            ? `${pendentes} demanda${pendentes > 1 ? "s" : ""} pendente${pendentes > 1 ? "s" : ""}`
            : undefined
        }
        actions={
          // ⚠️ ESTE BOTÃO APONTAVA PARA `/solicitar` FIXO, e a Spec 043 tornou
          // isso mentira: há N formulários, um por time. Vai para a tela que
          // LISTA os formulários. ⚠️ O TIME VAI JUNTO (14/09).
          <Link className="btn btn-ghost ml-auto" href={navHref("/formularios", active)}>
            Gerenciar formulários
          </Link>
        }
      />

      {/* ---------- 5. lista | envio escolhido ---------- */}
      {/* ⚠️ NO CELULAR, UMA COLUNA DE CADA VEZ: escolhido, a lista some e o
          painel ganha "Voltar". Duas colunas de 180px não cabem nada. */}
      <div className="grid items-start gap-4 md:grid-cols-[minmax(400px,11fr)_minmax(0,13fr)]">
        <section
          aria-label="Envios"
          className={`${escolhido ? "hidden md:flex" : "flex"} ${ALTURA_DO_PAINEL} min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]`}
        >
          <div className="flex flex-col gap-3 border-b border-border p-4">
            {/* ---------- 1. as abas ---------- */}
            <div role="tablist" aria-label="Situação" className="flex gap-0.5 overflow-x-auto rounded-lg bg-surface-2 p-1">
              {ABAS.map((a) => (
                <Aba
                  key={a.valor}
                  label={a.label}
                  numero={totais[a.valor]}
                  ativa={aba === a.valor}
                  onClick={() => filtrar(() => setAba(a.valor))}
                />
              ))}
            </div>

            {/* ---------- 2. busca e formulário ---------- */}
            <div className="relative">
              <Search aria-hidden size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
              <input
                className="input w-full"
                type="search"
                aria-label="Buscar solicitações"
                placeholder="Buscar por nome, e-mail ou protocolo"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                style={{ paddingLeft: 34 }}
              />
            </div>

            {(formularios.length > 1 || abaAtual.semTarefa) && (
              <div className="flex flex-wrap items-center gap-2">
                {formularios.length > 1 && (
                  <select
                    className="input min-w-0 flex-1"
                    aria-label="Formulário"
                    value={formId ?? ""}
                    onChange={(e) => filtrar(() => setFormId(e.target.value || null))}
                    style={{ fontSize: 12.5, padding: "5px 8px" }}
                  >
                    <option value="">Todos os formulários</option>
                    {formularios.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.title}
                      </option>
                    ))}
                  </select>
                )}
                {abaAtual.semTarefa && (
                  <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-[12.5px] text-ink-soft">
                    <input type="checkbox" checked={semTarefa} onChange={(e) => filtrar(() => setSemTarefa(e.target.checked))} />
                    Só sem tarefa
                    {(totais.WITHOUT_TASK ?? 0) > 0 && (
                      <Badge tone="soft" size="sm" color="#d97706">
                        {totais.WITHOUT_TASK}
                      </Badge>
                    )}
                  </label>
                )}
              </div>
            )}
          </div>

          {erro && (
            <div className="error-box" role="alert" style={{ margin: 12 }}>
              {erro}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {envios === null && <Loading />}
            {envios !== null && envios.length === 0 && !erro && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={MOLA}>
                <EmptyState
                  title={nomeDoTime ? `Nenhum envio em ${nomeDoTime}` : "Nenhum envio aqui"}
                  description={
                    buscaAtiva.trim() || formId
                      ? "Nada com esta busca. Tente outro nome, ou limpe o filtro."
                      : aba === "PENDING"
                        ? "Quando alguém enviar o formulário público, o pedido aparece nesta fila."
                        : filtrandoSemTarefa
                          ? "Toda demanda aceita já virou tarefa."
                          : "Nada com este filtro por enquanto."
                  }
                />
              </motion.div>
            )}
            {envios !== null && envios.length > 0 && (
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                <AnimatePresence initial={false} mode="popLayout">
                  {envios.map((envio, i) => (
                    <LinhaDoEnvio
                      key={envio.batch_id}
                      envio={envio}
                      ordem={i}
                      escolhido={escolhido?.batch_id === envio.batch_id}
                      onEscolher={(rejeitar) => escolher(envio, rejeitar)}
                      onMudou={recarregar}
                    />
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </div>

          {/* `rotulo` explicito: "Envios", porque os números das abas contam DEMANDAS (R5). */}
          {totalEnvios > TAMANHO_PAGINA && (
            <div className="border-t border-border px-3">
              <Paginacao
                pagina={pagina}
                total={totalEnvios}
                porPagina={TAMANHO_PAGINA}
                rotulo="Envios"
                onIr={(p) => setPagina(p)}
              />
            </div>
          )}
        </section>

        <section
          aria-label="Envio escolhido"
          className={`${escolhido ? "flex" : "hidden md:flex"} ${ALTURA_DO_PAINEL} min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]`}
        >
          {escolhido ? (
            <PainelDoEnvio
              key={escolhido.batch_id}
              envio={escolhido}
              rejeitarItem={rejeitarItem}
              onVoltar={() => setEscolhido(null)}
              onMudou={recarregar}
            />
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
            >
              <span className="grid h-12 w-12 place-items-center rounded-full bg-surface-2 text-ink-faint">
                <Inbox aria-hidden size={22} />
              </span>
              <p className="m-0 max-w-[260px] text-[13px] text-ink-faint">
                Escolha um envio na lista para ver as respostas e decidir.
              </p>
            </motion.div>
          )}
        </section>
      </div>
    </div>
  );
}

/** Uma aba do seletor de situação, com a pílula que desliza entre elas. */
function Aba({
  label,
  numero,
  ativa,
  onClick,
}: {
  label: string;
  numero: number | undefined;
  ativa: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={ativa}
      onClick={onClick}
      className={`relative flex-1 cursor-pointer whitespace-nowrap rounded-md border-0 bg-transparent px-2 py-1.5 text-[12px] transition-colors duration-150 ${
        ativa ? "font-semibold text-ink" : "text-ink-faint hover:text-ink-soft"
      }`}
    >
      {/* ⚠️ A PÍLULA É UMA SÓ, e desliza (`layoutId`): cinco fundos que
          piscam um de cada vez dariam a mesma informação sem dizer de onde
          a seleção veio. */}
      {ativa && (
        <motion.span
          layoutId="fila-aba-ativa"
          transition={MOLA}
          className="absolute inset-0 rounded-md bg-surface shadow-[var(--shadow-card)]"
        />
      )}
      <span className="relative">
        {label}
        {numero !== undefined && (
          <motion.span
            key={numero}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={MOLA}
            className={`ml-1.5 inline-block font-semibold ${ativa ? "text-accent" : ""}`}
          >
            {numero}
          </motion.span>
        )}
      </span>
    </button>
  );
}

/**
 * Uma linha da lista: quem pediu, de onde, e o que pediu.
 *
 * ⚠️ 3. AÇÃO SEM ABRIR (15/10): envio de UMA demanda pendente decide ali
 * mesmo -- o resumo já está na linha. Envio de várias abre o painel e decide
 * uma por uma: aprovar "o envio" de uma vez esconderia que cada demanda é
 * triada separadamente (Spec 043).
 */
function LinhaDoEnvio({
  envio,
  ordem,
  escolhido,
  onEscolher,
  onMudou,
}: {
  envio: Batch;
  ordem: number;
  escolhido: boolean;
  onEscolher: (rejeitar?: string | null) => void;
  onMudou: () => Promise<void>;
}) {
  const [agindo, setAgindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const unico = envio.items.length === 1 ? envio.items[0] : null;
  const temPendente = envio.items.some((i) => i.status === "PENDING");

  // ⚠️ O ✓ DA LISTA SÓ APROVA (decisão dela, 15/10): criar a tarefa fica no
  // painel, onde se vê o briefing antes. Aprovado sem tarefa, o pedido
  // aparece em "Só sem tarefa" -- não some.
  //
  // ⚠️⚠️ O ✓ FICA DESLIGADO ATÉ A LISTA NOVA CHEGAR, e o segundo clique de um
  // clique duplo é ignorado: o envio aprovado sai da aba e o de baixo sobe
  // para o lugar dele -- o segundo clique aprovava o pedido de OUTRA pessoa,
  // sem ninguém ver (revisão de 16/10).
  async function aprovar(item: BatchItem) {
    setAgindo(true);
    setErro(null);
    try {
      await aprovarSolicitacao(item.id);
      await onMudou();
    } catch (e) {
      setErro((e as ApiError).message || "Não foi possível aprovar.");
    } finally {
      setAgindo(false);
    }
  }

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, transition: { ...MOLA, delay: Math.min(ordem, 10) * 0.03 } }}
      exit={{ opacity: 0, x: -16, transition: { duration: 0.18 } }}
      className="group relative rounded-lg"
    >
      {/* O destaque do escolhido é UM só, e desliza de uma linha para outra. */}
      {escolhido && (
        <motion.span
          layoutId="fila-envio-escolhido"
          transition={MOLA}
          className="absolute inset-0 rounded-lg bg-accent-soft"
        />
      )}
      <button
        type="button"
        onClick={() => onEscolher(null)}
        aria-current={escolhido || undefined}
        className={`relative flex w-full cursor-pointer items-start gap-3 rounded-lg border-0 bg-transparent px-3 pt-2.5 text-left text-ink transition-colors duration-150 ${
          escolhido ? "" : "hover:bg-surface-2"
        } ${unico && unico.status === "PENDING" ? "pb-1" : "pb-2.5"}`}
      >
        <Avatar name={envio.requester_name} id={envio.requester_email} size="lg" className="mt-0.5" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{envio.requester_name}</span>
            <span className="shrink-0 text-[11px] text-ink-faint">{quandoChegou(envio.created_at)}</span>
            {/* Como o "não lido" de uma caixa de entrada: tem decisão a tomar. */}
            {temPendente && (
              <span className="h-2 w-2 shrink-0 self-center rounded-full bg-accent" title="Tem demanda pendente" />
            )}
          </span>
          <span className="truncate text-[11.5px] text-ink-faint">
            {/* Por qual formulário entrou (15/10: a fila não dizia). */}
            {envio.form_title && (
              <>
                <strong className="font-semibold text-ink-soft">{envio.form_title}</strong> ·{" "}
              </>
            )}
            {envio.items.length} demanda{envio.items.length > 1 ? "s" : ""}
          </span>
          <span className="mt-1.5 flex flex-col gap-1">
            {envio.items.map((item) => (
              <TopicoDaDemanda key={item.id} envio={envio} item={item} />
            ))}
          </span>
        </span>
      </button>

      {unico && unico.status === "PENDING" && (
        <div className="relative flex justify-end gap-1.5 px-3 pb-2.5 pl-[56px]">
          <button
            type="button"
            className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-ink-soft transition-colors duration-150 hover:border-[#16a34a] hover:text-[#15803d] disabled:opacity-60"
            disabled={agindo}
            aria-label="Aprovar"
            aria-busy={agindo || undefined}
            title="Aprovar (a tarefa você cria no painel)"
            onClick={(e) => {
              if (e.detail > 1) return;
              aprovar(unico);
            }}
          >
            <Check aria-hidden size={14} />
            <span aria-hidden>{agindo ? "…" : "Aprovar"}</span>
          </button>
          <button
            type="button"
            className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-ink-soft transition-colors duration-150 hover:border-danger hover:text-danger disabled:opacity-60"
            disabled={agindo}
            aria-label="Rejeitar"
            title="Rejeitar (pede justificativa)"
            onClick={() => onEscolher(unico.id)}
          >
            <X aria-hidden size={14} />
            <span aria-hidden>Rejeitar</span>
          </button>
        </div>
      )}
      {erro && (
        <div className="error-box relative" role="alert" style={{ margin: "0 12px 10px", fontSize: 12 }}>
          {erro}
        </div>
      )}
    </motion.li>
  );
}

/** Uma demanda na linha da lista: ponto da situação, seção e resumo. */
function TopicoDaDemanda({ envio, item }: { envio: Batch; item: BatchItem }) {
  const cat = rotuloDaCategoria(item);
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[12px]">
      {/* ⚠️ A SITUAÇÃO É UM PONTO (15/10, vista na tela): a etiqueta
          "Pendente" em toda linha repetia a aba em que a pessoa já está. O
          nome vai no `title` e no texto para leitor de tela; fora de
          "pendente", ele também aparece, curto, no fim da linha. */}
      <span
        title={STATUS_LABEL[item.status]}
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: STATUS_COLOR[item.status] }}
      />
      <span className="sr-only">{STATUS_LABEL[item.status]}:</span>
      <span aria-hidden>{cat.emoji}</span>
      <span className="min-w-0 flex-1 truncate">
        <strong className="font-semibold text-ink-soft">
          {cat.titulo}
          {numeroDaRepeticao(envio.items, item)}
        </strong>
        <span className="text-ink-faint"> · {item.summary}</span>
      </span>
      {item.status !== "PENDING" && (
        <span aria-hidden className="shrink-0 text-[11px] font-semibold" style={{ color: STATUS_COLOR[item.status] }}>
          {STATUS_LABEL[item.status]}
        </span>
      )}
    </span>
  );
}

/** Uma linha de propriedade do painel: ícone, rótulo e valor. */
function Propriedade({ icone, rotulo, children }: { icone: ReactNode; rotulo: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(110px,150px)_minmax(0,1fr)] items-baseline gap-3 py-1.5">
      <dt className="flex items-center gap-2 text-[12.5px] text-ink-faint">
        <span aria-hidden className="translate-y-[1px]">{icone}</span>
        {rotulo}
      </dt>
      <dd className="m-0 min-w-0 break-words text-[13px] text-ink">{children}</dd>
    </div>
  );
}

/** O envio escolhido: quem pediu, e cada demanda com a sua triagem. */
function PainelDoEnvio({
  envio,
  rejeitarItem,
  onVoltar,
  onMudou,
}: {
  envio: Batch;
  rejeitarItem: string | null;
  onVoltar: () => void;
  onMudou: () => Promise<void>;
}) {
  // Com várias demandas, uma de cada vez, por abas: empilhadas, a terceira
  // ficava fora da tela, longe do nome de quem pediu.
  const [ativa, setAtiva] = useState<string | null>(rejeitarItem ?? demandaInicial(envio));
  const atual = envio.items.find((i) => i.id === ativa) ?? envio.items[0];
  const [protocoloCopiado, setProtocoloCopiado] = useState(false);
  const lugar = [envio.requester_department, envio.requester_polo].filter(Boolean).join(" / ");
  const pendentes = envio.items.filter((i) => i.status === "PENDING").length;

  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={MOLA}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
    >
      {/* ⚠️⚠️ TUDO AQUI DENTRO É `shrink-0`: o painel rola por dentro, e numa
          coluna flex quem pode encolher encolhe. A barra das abas tem
          `overflow-x-auto`, e caixa com overflow pode encolher até ZERO --
          com um envio de seis demandas e respostas longas as abas sumiam, e
          só a primeira demanda ficava alcançável (visto em produção, 16/10). */}
      <div className="shrink-0 border-b border-border p-5 pb-4">
        {/* ⚠️ O `md:hidden` FICA NUM DIV EM VOLTA, e não no botão: o `display`
            do `.btn` vence a classe utilitária, e o "Voltar" aparecia no
            computador (visto na tela, 15/10). */}
        <div className="mb-3 md:hidden">
          <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 8px" }} onClick={onVoltar}>
            <ArrowLeft aria-hidden size={14} /> Voltar
          </button>
        </div>

        <div className="flex items-center gap-3">
          <Avatar name={envio.requester_name} id={envio.requester_email} size="lg" className="h-11! w-11! text-[15px]!" />
          <div className="min-w-0 flex-1">
            <h2 className="m-0 truncate text-[19px] font-bold tracking-[-0.01em]">{envio.requester_name}</h2>
            <p className="m-0 text-[12px] text-ink-faint">
              {envio.items.length} demanda{envio.items.length > 1 ? "s" : ""}
              {pendentes > 0 && ` · ${pendentes} pendente${pendentes > 1 ? "s" : ""}`}
            </p>
          </div>
        </div>

        {/* ⚠️ OS SEPARADORES: `/` entre área e polo é o desenho que ela
            mandou voltar (revisão de 31/08), e campo `null` não deixa
            separador pendurado -- cada propriedade só existe se tem valor. */}
        <dl className="m-0 mt-4">
          {envio.form_title && (
            <Propriedade icone={<FileText size={14} />} rotulo="Formulário">
              {envio.form_title}
            </Propriedade>
          )}
          <Propriedade icone={<Hash size={14} />} rotulo="Protocolo">
            <button
              type="button"
              className="inline-flex cursor-pointer items-center gap-1.5 rounded border-0 bg-transparent p-0 font-semibold tracking-[0.04em] text-ink hover:text-accent"
              title="Copiar protocolo"
              onClick={() =>
                navigator.clipboard?.writeText(envio.protocol).then(() => {
                  setProtocoloCopiado(true);
                  setTimeout(() => setProtocoloCopiado(false), 1500);
                })
              }
            >
              {envio.protocol}
              {protocoloCopiado ? <Check aria-hidden size={13} /> : <Copy aria-hidden size={12} className="opacity-60" />}
            </button>
          </Propriedade>
          <Propriedade icone={<CalendarDays size={14} />} rotulo="Recebido">
            {diaDoEnvio(envio.created_at)}
          </Propriedade>
          <Propriedade icone={<Mail size={14} />} rotulo="E-mail">
            <a href={`mailto:${envio.requester_email}`} className="text-ink hover:text-accent">
              {envio.requester_email}
            </a>
          </Propriedade>
          {envio.requester_phone && (
            <Propriedade icone={<Phone size={14} />} rotulo="Telefone">
              {envio.requester_phone}
            </Propriedade>
          )}
          {lugar && (
            <Propriedade icone={<MapPin size={14} />} rotulo="Área / Polo">
              {lugar}
            </Propriedade>
          )}
        </dl>
      </div>

      {envio.items.length > 1 && (
        <div role="tablist" aria-label="Demandas do envio" className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-4">
          {envio.items.map((item) => {
            const cat = rotuloDaCategoria(item);
            const sel = item.id === atual.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={sel}
                onClick={() => setAtiva(item.id)}
                className={`relative flex shrink-0 cursor-pointer items-center gap-1.5 border-0 bg-transparent px-2.5 py-2.5 text-[12.5px] transition-colors duration-150 ${
                  sel ? "font-semibold text-ink" : "text-ink-faint hover:text-ink-soft"
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[item.status] }} title={STATUS_LABEL[item.status]} />
                <span aria-hidden>{cat.emoji}</span>
                {cat.titulo}
                {numeroDaRepeticao(envio.items, item)}
                {sel && (
                  <motion.span
                    layoutId={`fila-demanda-${envio.batch_id}`}
                    transition={MOLA}
                    className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-accent"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      <motion.div
        key={atual.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={MOLA}
        className="shrink-0 p-5"
      >
        <SecaoDemanda
          key={`${atual.id}-${rejeitarItem === atual.id}`}
          envio={envio}
          item={atual}
          rejeitarAoAbrir={rejeitarItem === atual.id}
          onMudou={onMudou}
        />
      </motion.div>
    </motion.div>
  );
}

/** Aparece suave de cima: formulário de rejeição, de marcar, aviso. */
function Surge({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={MOLA} className={className}>
      {children}
    </motion.div>
  );
}

/** Uma demanda do envio: briefing completo + triagem independente. */
function SecaoDemanda({
  envio,
  item,
  rejeitarAoAbrir = false,
  onMudou,
}: {
  envio: Batch;
  item: BatchItem;
  /** Veio do ✕ da lista: já abre pedindo a justificativa. */
  rejeitarAoAbrir?: boolean;
  onMudou: () => Promise<void>;
}) {
  const cat = rotuloDaCategoria(item);
  const aceito = STATUS_ACEITOS.includes(item.status);
  const [erro, setErro] = useState<string | null>(null);
  const [agindo, setAgindo] = useState(false);
  const [rejeitando, setRejeitando] = useState(rejeitarAoAbrir);
  const [menuAberto, setMenuAberto] = useState(false);
  // ⚠️ O MENU DA SETA É `AnchoredPanel` (fixo), e não `absolute`: o painel
  // rola por dentro e o recortava -- ela abria e tinha de rolar para ver
  // (print dela, 15/10). Fixo, ele sobrepõe tudo e abre para cima quando o
  // botão está no pé da tela.
  const { anchorRef: menu, panelRef: painelDoMenu, box: caixaDoMenu } = useAnchoredPanel<HTMLDivElement>(
    menuAberto,
    () => setMenuAberto(false),
    { larguraPainel: 240 }
  );
  const justificativaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (rejeitarAoAbrir) justificativaRef.current?.focus();
  }, [rejeitarAoAbrir]);
  // Esc, clique fora e rolagem: quem fecha o menu é o `useAnchoredPanel`.
  const [justificativa, setJustificativa] = useState("");
  const [marcandoTarefa, setMarcandoTarefa] = useState(false);
  // ⚠️ GUARDA O ID DA TAREFA RECÉM-CRIADA para oferecer "abrir a tarefa" sem
  // um segundo request -- é o passo seguinte natural de quem acabou de criar
  // uma, e sem isso a pessoa teria de procurá-la no quadro.
  const [tarefaNova, setTarefaNova] = useState<string | null>(null);
  const [refTarefa, setRefTarefa] = useState("");
  const [copiado, setCopiado] = useState(false);

  // ⚠️ RECARREGA MESMO QUANDO FALHA: uma ação de dois passos (aprovar e
  // criar a tarefa) pode falhar no segundo com o primeiro já feito, e a tela
  // continuaria dizendo "pendente" de um pedido aprovado (revisão de 16/10).
  async function acao(fn: () => Promise<unknown>, msgErro: string) {
    setAgindo(true);
    setErro(null);
    try {
      await fn();
    } catch (e) {
      setErro((e as ApiError).message || msgErro);
    }
    try {
      await onMudou();
    } finally {
      setAgindo(false);
    }
  }

  function copiarBriefing() {
    const linhas = [
      `[${cat.titulo}${numeroDaRepeticao(envio.items, item)}] ${item.summary}`,
      // ⚠️⚠️ TEMPLATE LITERAL COM CAMPO OPCIONAL ESCREVE A STRING "null".
      // Este texto vai para a área de transferência e daí para o WhatsApp, o
      // e-mail, a descrição de uma tarefa -- ou seja, o "null" VAZA PARA FORA
      // do sistema, até o solicitante. Achado pela revisão de 31/08.
      `Solicitante: ${[
        envio.requester_name,
        envio.requester_email,
        envio.requester_phone,
      ]
        .filter(Boolean)
        .join(" · ")}`,
      // ⚠️ A LINHA INTEIRA SOME quando o formulário não pergunta nenhum dos
      // dois -- "Área:  · Polo: " vazio parece dado perdido.
      ...(envio.requester_department || envio.requester_polo
        ? [
            [
              envio.requester_department ? `Área: ${envio.requester_department}` : "",
              envio.requester_polo ? `Polo: ${envio.requester_polo}` : "",
            ]
              .filter(Boolean)
              .join(" · "),
          ]
        : []),
      `Protocolo: ${envio.protocol}${envio.items.length > 1 ? ` (${item.batch_seq}/${envio.items.length})` : ""} · Recebida em ${diaDoEnvio(envio.created_at)}`,
      "",
      ...item.answers.map((a) => `${a.label}\n${a.value}\n`),
    ];
    navigator.clipboard.writeText(linhas.join("\n")).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    });
  }

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-[16px] font-bold">
          <span aria-hidden className="mr-1.5">{cat.emoji}</span>
          {cat.titulo}
          {numeroDaRepeticao(envio.items, item)}
        </h3>
        <Badge tone="soft" size="sm" color={STATUS_COLOR[item.status]}>
          {STATUS_LABEL[item.status]}
        </Badge>
      </div>
      {cat.prazo && (
        <p className="m-0 flex items-center gap-1.5 text-[12px] text-ink-faint">
          <Clock aria-hidden size={13} /> {cat.prazo}
        </p>
      )}

      {erro && (
        <Surge className="mt-3">
          <div className="error-box" role="alert">{erro}</div>
        </Surge>
      )}

      <h4 className="mb-1 mt-5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint">Respostas</h4>
      <dl className="m-0 divide-y divide-border rounded-lg border border-border">
        {item.answers.map((a, i) => (
          <div key={i} className="grid gap-1 px-3.5 py-2.5 sm:grid-cols-[minmax(140px,38%)_minmax(0,1fr)] sm:gap-4">
            <dt className="text-[12.5px] text-ink-faint">{a.label}</dt>
            <dd className="m-0 whitespace-pre-wrap text-[13px] [overflow-wrap:anywhere]">
              {/^https?:\/\//.test(a.value) ? (
                <a href={a.value} target="_blank" rel="noreferrer" className="text-accent">
                  {a.value}
                </a>
              ) : (
                a.value
              )}
            </dd>
          </div>
        ))}
      </dl>

      {item.status === "REJECTED" && item.review_note && (
        <div className="error-box" style={{ marginTop: 12 }}>
          Justificativa: {item.review_note}
        </div>
      )}
      {item.status === "APPROVED" && item.review_note && (
        <p className="mt-3 text-[12px] text-ink-faint">Nota da aprovação: {item.review_note}</p>
      )}

      {aceito && item.task_created_at && (
        <p className="mt-4 flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink-soft">
          <SquareCheckBig aria-hidden size={14} className="text-[#16a34a]" />
          Tarefa criada em {diaDoEnvio(item.task_created_at)}
          {/* ⚠️ TRÊS ESTADOS, e cada um diz a verdade sobre o que existe:
              vinculada e viva (link), vinculada e apagada (sem nome, sem
              link), ou só o `task_ref` de texto das marcações antigas. */}
          {item.task_id && item.task_title && (
            <>
              {" · "}
              <Link href={`/tarefa/${item.task_id}`}>{item.task_title}</Link>
            </>
          )}
          {item.task_id && !item.task_title && " · tarefa vinculada"}
          {!item.task_id && item.task_ref ? ` · ${item.task_ref}` : ""}
        </p>
      )}

      {tarefaNova && (
        <Surge className="mt-4">
          <div className="flex items-center gap-2 rounded-lg border border-[#16a34a]/40 bg-[#16a34a]/10 px-3 py-2 text-[12.5px]">
            <Check aria-hidden size={14} className="text-[#16a34a]" />
            Tarefa criada.
            <Link href={`/tarefa/${tarefaNova}`} className="font-semibold">
              Abrir a tarefa
            </Link>
          </div>
        </Surge>
      )}

      {/* ---- ações ---- */}
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {/* ⚠️ O ANDAMENTO É UM SELETOR, e não um botão "avançar": volta-se de
            "concluída" para "em andamento" de propósito. Marcar concluída por
            engano é comum, e sem a volta a saída seria pedir para alguém mexer
            no banco. O backend permite os dois sentidos; a tela também. */}
        {aceito && (
          <label className="inline-flex items-center gap-1.5">
            <span className="text-[12px] text-ink-faint">Situação</span>
            <select
              className="input"
              style={{ fontSize: 12, padding: "4px 8px", width: "auto" }}
              aria-label={`Situação de ${cat.titulo}`}
              value={item.status}
              disabled={agindo}
              onChange={(e) =>
                acao(
                  () => andarSolicitacao(item.id, e.target.value as SolicitacaoStatus),
                  "Não foi possível mudar a situação."
                )
              }
            >
              {STATUS_ACEITOS.map((st) => (
                <option key={st} value={st}>
                  {STATUS_LABEL[st]}
                </option>
              ))}
            </select>
          </label>
        )}

        {/* ⚠️ 4. "APROVAR E CRIAR TAREFA" É O CAMINHO PRINCIPAL (15/10): quase
            todo pedido aceito vira tarefa, e eram dois cliques em dois
            momentos -- o segundo era o que se esquecia. Os outros dois
            caminhos moram na seta. Com as demandas em abas, há UM destes
            por vez na tela -- por isso ele pode ser o azul cheio. */}
        {item.status === "PENDING" && !rejeitando && (
          <>
            <div ref={menu} className="relative inline-flex">
              <button
                className="btn btn-primary"
                disabled={agindo}
                style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
                onClick={() =>
                  acao(async () => {
                    await aprovarSolicitacao(item.id);
                    try {
                      const nova = await criarTarefaDaSolicitacao(item.id);
                      setTarefaNova(nova.task_id);
                    } catch (e) {
                      const motivo = (e as ApiError).message;
                      throw new Error(
                        `O pedido foi aprovado, mas a tarefa não foi criada${motivo ? ` (${motivo})` : ""}. Tente "Criar tarefa".`
                      );
                    }
                  }, "Não foi possível aprovar.")
                }
              >
                {agindo ? "Aprovando…" : "Aprovar e criar tarefa"}
              </button>
              <button
                className="btn btn-primary"
                disabled={agindo}
                aria-label="Outras formas de aprovar"
                aria-expanded={menuAberto}
                style={{
                  borderTopLeftRadius: 0,
                  borderBottomLeftRadius: 0,
                  borderLeft: "1px solid rgba(255,255,255,.3)",
                  padding: "0 9px",
                }}
                onClick={() => setMenuAberto((v) => !v)}
              >
                <motion.span animate={{ rotate: menuAberto ? 180 : 0 }} transition={MOLA} className="inline-flex">
                  <ChevronDown aria-hidden size={15} />
                </motion.span>
              </button>
              {menuAberto && caixaDoMenu && (
                <AnchoredPanel box={caixaDoMenu} panelRef={painelDoMenu} role="menu" aria-label="Formas de aprovar" minWidth={240}>
                  <button
                    role="menuitem"
                    className="btn btn-ghost"
                    style={{ width: "100%", justifyContent: "flex-start", fontSize: 13 }}
                    onClick={() => {
                      setMenuAberto(false);
                      acao(() => aprovarSolicitacao(item.id), "Não foi possível aprovar.");
                    }}
                  >
                    Aprovar sem tarefa
                  </button>
                  <button
                    role="menuitem"
                    className="btn btn-ghost"
                    style={{ width: "100%", justifyContent: "flex-start", fontSize: 13 }}
                    onClick={() => {
                      setMenuAberto(false);
                      acao(async () => {
                        await aprovarSolicitacao(item.id);
                        setMarcandoTarefa(true);
                      }, "Não foi possível aprovar.");
                    }}
                  >
                    Aprovar — já criei a tarefa
                  </button>
                </AnchoredPanel>
              )}
            </div>
            <button
              className="btn"
              style={{ color: "var(--danger)" }}
              disabled={agindo}
              onClick={() => setRejeitando(true)}
            >
              Rejeitar
            </button>
          </>
        )}

        {/* ⚠️ OS TRÊS ACEITOS, e não só APPROVED (Spec 043, fatia D). A tarefa
            costuma ser criada quando o trabalho COMEÇA -- ou seja, com o
            pedido já em andamento. Exigir "aprovada" aqui esconderia o botão
            exatamente no momento em que ele é usado. */}
        {aceito && !item.task_created_at && (
          <button
            className="btn btn-primary"
            disabled={agindo}
            onClick={() =>
              acao(async () => {
                const nova = await criarTarefaDaSolicitacao(item.id);
                setTarefaNova(nova.task_id);
              }, "Não foi possível criar a tarefa.")
            }
          >
            {agindo ? "Criando…" : "Criar tarefa"}
          </button>
        )}
        {aceito && !item.task_created_at && !marcandoTarefa && (
          <button className="btn" onClick={() => setMarcandoTarefa(true)}>
            Já criei — só marcar
          </button>
        )}
        {aceito && item.task_created_at && (
          <button
            className="btn btn-ghost"
            disabled={agindo}
            onClick={() => acao(() => marcarTarefaCriada(item.id, false), "Não foi possível desmarcar.")}
          >
            Desmarcar tarefa
          </button>
        )}

        <button className="btn btn-ghost" style={{ marginLeft: "auto" }} onClick={copiarBriefing}>
          {copiado ? <Check aria-hidden size={14} /> : <Copy aria-hidden size={14} />}
          {copiado ? "Copiado ✓" : "Copiar briefing"}
        </button>
      </div>

      {marcandoTarefa && (
        <Surge className="mt-3 flex flex-col gap-2">
          <label className="label" htmlFor={`ref-${item.id}`}>
            Link ou identificador da tarefa (opcional)
          </label>
          <input
            id={`ref-${item.id}`}
            className="input"
            placeholder="Ex.: link da tarefa no quadro"
            value={refTarefa}
            onChange={(e) => setRefTarefa(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              className="btn btn-primary"
              disabled={agindo}
              onClick={() =>
                acao(
                  () => marcarTarefaCriada(item.id, true, refTarefa.trim() || undefined),
                  "Não foi possível marcar."
                )
              }
            >
              {agindo ? "…" : "Confirmar"}
            </button>
            <button
              className="btn btn-ghost"
              disabled={agindo}
              onClick={() => {
                setMarcandoTarefa(false);
                setRefTarefa("");
              }}
            >
              Cancelar
            </button>
          </div>
        </Surge>
      )}

      {rejeitando && (
        <Surge className="mt-3 flex flex-col gap-2">
          <label className="label" htmlFor={`just-${item.id}`}>
            Justificativa da rejeição (obrigatória)
          </label>
          <textarea
            ref={justificativaRef}
            id={`just-${item.id}`}
            className="input"
            rows={3}
            value={justificativa}
            onChange={(e) => setJustificativa(e.target.value)}
            placeholder="Ex.: prazo insuficiente para o porte da demanda; reenviar com pelo menos 10 dias úteis."
            style={{ resize: "vertical" }}
          />
          <div className="flex gap-2">
            <button
              className="btn"
              style={{ color: "var(--danger)" }}
              disabled={agindo}
              onClick={() => {
                if (!justificativa.trim()) {
                  setErro("A rejeição exige uma justificativa.");
                  return;
                }
                acao(() => rejeitarSolicitacao(item.id, justificativa.trim()), "Não foi possível rejeitar.");
              }}
            >
              {agindo ? "…" : "Confirmar rejeição"}
            </button>
            <button
              className="btn btn-ghost"
              disabled={agindo}
              onClick={() => {
                setRejeitando(false);
                setJustificativa("");
              }}
            >
              Cancelar
            </button>
          </div>
        </Surge>
      )}
    </div>
  );
}
