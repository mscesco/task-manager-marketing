"use client";
// /solicitacoes — fila de triagem agrupada por ENVIO.
//
// UMA LINHA POR SUBMISSÃO, não por demanda: quem preenche o formulário
// escolhendo 4 categorias gerava 4 cards soltos, e ninguém enxergava que
// eram da mesma pessoa.
//
// ⚠️ DUAS COLUNAS DESDE 15/10 (proposta aprovada por ela, "fica bem melhor"):
// a lista de envios à esquerda e o envio escolhido à direita. O card que
// abria e fechava fazia a página pular, e aprovar exigia abrir, achar a
// seção e voltar. Os números no código (1 a 5) são os da proposta.
//
// A aprovação continua sendo POR SEÇÃO (aprovar a arte, rejeitar a
// divulgação). O agrupamento é só de visualização.
//
// "Tarefa criada" é autodeclarado — ninguém verifica. O valor está no
// contrário: o filtro "Aprovadas sem tarefa" mostra o que foi aceito e
// nunca virou tarefa. Sem esse filtro, a marcação seria decorativa.

import { useCallback, useEffect, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import Badge from "@/components/Badge";
import Card from "@/components/Card";
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

import Loading from "@/components/Loading";
import { useActiveTeam, useActiveTeamId } from "@/lib/useActiveTeam";
import { navHref } from "@/lib/activeTeam";
import Paginacao from "@/components/Paginacao";
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

export default function SolicitacoesPage() {
  return (
    <AppShell>
      <Solicitacoes />
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

  // A busca espera a pessoa parar de digitar: uma ida ao servidor por tecla
  // refaria a lista enquanto ela ainda escreve o nome.
  useEffect(() => {
    const t = setTimeout(() => setBuscaAtiva(busca), 300);
    return () => clearTimeout(t);
  }, [busca]);

  const carregar = useCallback(async () => {
    // ⚠⚠ ESPERA O TIME em vez de buscar sem recorte. Buscar antes mostraria a
    // fila da organização inteira por um instante -- e aqui isso é pior que numa
    // lista qualquer: quem tria poderia APROVAR um pedido de outro time no
    // meio do pisca.
    if (active === null) return;
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
      setEnvios(r.items);
      setTotalEnvios(r.total);
      setTotais(
        r.tab_totals ?? {
          PENDING: r.pending_total,
          WITHOUT_TASK: r.approved_without_task_total,
        }
      );
      setFormularios(r.form_options ?? []);
    } catch (err) {
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

  // Trocar de aba, busca ou formulário reinicia a paginação: manter a página
  // 3 costuma cair numa página que não existe mais.
  useEffect(() => {
    setPagina(1);
  }, [aba, buscaAtiva, formId, filtrandoSemTarefa]);

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

      {/* ---------- 1. as abas ---------- */}
      <div
        role="tablist"
        aria-label="Situação"
        style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}
      >
        {ABAS.map((a) => {
          const n = totais[a.valor];
          const ativa = aba === a.valor;
          return (
            <button
              key={a.valor}
              role="tab"
              aria-selected={ativa}
              type="button"
              className="btn btn-ghost"
              onClick={() => setAba(a.valor)}
              style={{
                fontSize: 13,
                padding: "5px 10px",
                ...(ativa
                  ? { background: "var(--surface-2)", boxShadow: "inset 0 0 0 1px var(--border-strong)", fontWeight: 600 }
                  : { color: "var(--text-soft)" }),
              }}
            >
              {a.label}
              {n !== undefined && (
                <span style={{ marginLeft: 6, fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{n}</span>
              )}
            </button>
          );
        })}
        {abaAtual.semTarefa && (
          <label
            style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}
            className="muted"
          >
            <input type="checkbox" checked={semTarefa} onChange={(e) => setSemTarefa(e.target.checked)} />
            Só sem tarefa
            {(totais.WITHOUT_TASK ?? 0) > 0 && (
              <Badge tone="soft" size="sm" color="#d97706">
                {totais.WITHOUT_TASK}
              </Badge>
            )}
          </label>
        )}
      </div>

      {filtrandoSemTarefa && (
        <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
          Demandas aceitas que ninguém transformou em tarefa. Se já viraram
          tarefa, marque — senão elas somem de vista até o solicitante cobrar.
        </p>
      )}

      {/* ---------- 2. busca e formulário ---------- */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <input
          className="input"
          type="search"
          aria-label="Buscar solicitações"
          placeholder="Buscar por nome, e-mail ou protocolo"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          style={{ flex: "1 1 240px" }}
        />
        {formularios.length > 1 && (
          <select
            className="input"
            aria-label="Formulário"
            value={formId ?? ""}
            onChange={(e) => setFormId(e.target.value || null)}
            style={{ flex: "0 1 240px", width: "auto" }}
          >
            <option value="">Todos os formulários</option>
            {formularios.map((f) => (
              <option key={f.id} value={f.id}>
                {f.title}
              </option>
            ))}
          </select>
        )}
      </div>

      {erro && <div className="error-box" style={{ marginBottom: 16 }}>{erro}</div>}

      {/* ---------- 5. lista | envio escolhido ---------- */}
      {/* ⚠️ NO CELULAR, UMA COLUNA DE CADA VEZ: escolhido, a lista some e o
          painel ganha "‹ Voltar". Duas colunas de 180px não cabem nada. */}
      <div className="grid gap-3 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start">
        <div className={escolhido ? "hidden md:block" : ""}>
          {envios === null && <Loading />}
          {envios !== null && envios.length === 0 && !erro && (
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
          )}
          {envios !== null && envios.length > 0 && (
            <Card className="overflow-hidden p-0">
              {envios.map((envio, i) => (
                <LinhaDoEnvio
                  key={envio.batch_id}
                  envio={envio}
                  primeira={i === 0}
                  escolhido={escolhido?.batch_id === envio.batch_id}
                  onEscolher={(rejeitar) => escolher(envio, rejeitar)}
                  onMudou={recarregar}
                />
              ))}
            </Card>
          )}
          {/* `rotulo` explicito: "Envios", porque os números das abas contam DEMANDAS (R5). */}
          <Paginacao
            pagina={pagina}
            total={totalEnvios}
            porPagina={TAMANHO_PAGINA}
            rotulo="Envios"
            onIr={(p) => {
              setPagina(p);
              window.scrollTo({ top: 0 });
            }}
          />
        </div>

        <div className={escolhido ? "" : "hidden md:block"}>
          {escolhido ? (
            <PainelDoEnvio
              key={escolhido.batch_id}
              envio={escolhido}
              rejeitarItem={rejeitarItem}
              onVoltar={() => setEscolhido(null)}
              onMudou={recarregar}
            />
          ) : (
            <div
              className="muted"
              style={{
                border: "1px dashed var(--border)",
                borderRadius: 12,
                padding: 32,
                textAlign: "center",
                fontSize: 13,
              }}
            >
              Escolha um envio na lista para ver as respostas e decidir.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Quando chegou, curto: "hoje", "ontem", ou a data. */
function quando(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date();
  const dia = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dias = Math.round((dia(hoje) - dia(d)) / 86_400_000);
  if (dias === 0) return "hoje";
  if (dias === 1) return "ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
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
  primeira,
  escolhido,
  onEscolher,
  onMudou,
}: {
  envio: Batch;
  primeira: boolean;
  escolhido: boolean;
  onEscolher: (rejeitar?: string | null) => void;
  onMudou: () => void;
}) {
  const [agindo, setAgindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const unico = envio.items.length === 1 ? envio.items[0] : null;
  const pendentes = envio.items.filter((i) => i.status === "PENDING").length;

  async function aprovarECriar(item: BatchItem) {
    setAgindo(true);
    setErro(null);
    try {
      await aprovarSolicitacao(item.id);
      await criarTarefaDaSolicitacao(item.id);
      onMudou();
    } catch (e) {
      setErro((e as ApiError).message || "Não foi possível aprovar.");
      onMudou();
    } finally {
      setAgindo(false);
    }
  }

  return (
    <div
      style={{
        borderTop: primeira ? undefined : "1px solid var(--border)",
        background: escolhido ? "var(--surface-2)" : undefined,
        boxShadow: escolhido ? "inset 3px 0 0 var(--accent)" : undefined,
      }}
    >
      <button
        type="button"
        onClick={() => onEscolher(null)}
        aria-current={escolhido || undefined}
        style={{
          display: "block",
          width: "100%",
          textAlign: "left",
          background: "transparent",
          border: 0,
          padding: "10px 14px 4px",
          cursor: "pointer",
          color: "var(--text)",
          fontFamily: "inherit",
        }}
      >
        <span style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
          <span style={{ fontWeight: 600, fontSize: 14, flex: 1, minWidth: 0 }}>{envio.requester_name}</span>
          {pendentes > 0 && !unico && (
            <Badge tone="soft" size="sm" color={STATUS_COLOR.PENDING}>
              {pendentes} pendente{pendentes > 1 ? "s" : ""}
            </Badge>
          )}
          <span className="muted" style={{ fontSize: 11 }}>{quando(envio.created_at)}</span>
        </span>
        <span className="muted" style={{ display: "block", fontSize: 11.5, marginTop: 1 }}>
          {/* Por qual formulário entrou (15/10: a fila não dizia). */}
          {envio.form_title && (
            <>
              <strong style={{ fontWeight: 600 }}>{envio.form_title}</strong> ·{" "}
            </>
          )}
          {envio.items.length} demanda{envio.items.length > 1 ? "s" : ""}
        </span>
      </button>

      <ul style={{ listStyle: "none", margin: 0, padding: "2px 14px 10px", display: "flex", flexDirection: "column", gap: 3 }}>
        {envio.items.map((item) => {
          const cat = rotuloDaCategoria(item);
          return (
            <li key={item.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, minWidth: 0 }}>
              <span aria-hidden>{cat.emoji}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <strong style={{ fontWeight: 600 }}>
                  {cat.titulo}
                  {numeroDaRepeticao(envio.items, item)}
                </strong>
                <span className="muted"> · {item.summary}</span>
              </span>
              {unico && item.status === "PENDING" ? (
                <>
                  <button
                    type="button"
                    className="btn"
                    style={{ fontSize: 12, padding: "2px 8px" }}
                    disabled={agindo}
                    aria-label="Aprovar e criar tarefa"
                    title="Aprovar e criar tarefa"
                    onClick={() => aprovarECriar(item)}
                  >
                    {agindo ? "…" : "✓"}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    style={{ fontSize: 12, padding: "2px 8px", color: "var(--danger)" }}
                    disabled={agindo}
                    aria-label="Rejeitar"
                    title="Rejeitar (pede justificativa)"
                    onClick={() => onEscolher(item.id)}
                  >
                    ✕
                  </button>
                </>
              ) : (
                <Badge tone="soft" size="sm" color={STATUS_COLOR[item.status]}>
                  {STATUS_LABEL[item.status]}
                </Badge>
              )}
            </li>
          );
        })}
      </ul>
      {erro && (
        <div className="error-box" role="alert" style={{ margin: "0 14px 10px", fontSize: 12 }}>
          {erro}
        </div>
      )}
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
  onMudou: () => void;
}) {
  return (
    <Card className="p-4">
      <button type="button" className="btn btn-ghost md:hidden" style={{ fontSize: 12, marginBottom: 8 }} onClick={onVoltar}>
        ‹ Voltar
      </button>
      <div style={{ fontWeight: 600, fontSize: 15 }}>{envio.requester_name}</div>
      {/* ⚠️ `filter(Boolean)` E NAO SEPARADOR FIXO. Desde a fatia G,
          `requester_department` e `requester_polo` podem ser `null` -- em
          JSX o `null` some, mas o `·` e o `/` FICAM (revisão de 31/08).

          ⚠️ E OS DOIS SEPARADORES SÃO DIFERENTES DE PROPÓSITO: `·` separa
          o e-mail do lugar, `/` separa área de polo. A Camila mandou voltar
          quando eu juntei tudo com `·`. */}
      <div className="muted" style={{ fontSize: 12 }}>
        {[
          [envio.requester_email, envio.requester_phone].filter(Boolean).join(" · "),
          [envio.requester_department, envio.requester_polo].filter(Boolean).join(" / "),
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 2, marginBottom: 12 }}>
        {envio.form_title && (
          <>
            Formulário <strong>{envio.form_title}</strong> ·{" "}
          </>
        )}
        Protocolo <strong>{envio.protocol}</strong> ·{" "}
        {new Date(envio.created_at).toLocaleDateString("pt-BR")}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {envio.items.map((item) => (
          <SecaoDemanda
            key={`${item.id}-${rejeitarItem === item.id}`}
            envio={envio}
            item={item}
            rejeitarAoAbrir={rejeitarItem === item.id}
            onMudou={onMudou}
          />
        ))}
      </div>
    </Card>
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
  onMudou: () => void;
}) {
  const cat = rotuloDaCategoria(item);
  const aceito = STATUS_ACEITOS.includes(item.status);
  const [erro, setErro] = useState<string | null>(null);
  const [agindo, setAgindo] = useState(false);
  const [rejeitando, setRejeitando] = useState(rejeitarAoAbrir);
  const [menuAberto, setMenuAberto] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const justificativaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (rejeitarAoAbrir) justificativaRef.current?.focus();
  }, [rejeitarAoAbrir]);
  // O menu da seta fecha ao clicar fora, como qualquer menu.
  useEffect(() => {
    if (!menuAberto) return;
    const fora = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node)) setMenuAberto(false);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [menuAberto]);
  const [justificativa, setJustificativa] = useState("");
  const [marcandoTarefa, setMarcandoTarefa] = useState(false);
  // ⚠️ GUARDA O ID DA TAREFA RECÉM-CRIADA para oferecer "abrir a tarefa" sem
  // um segundo request -- é o passo seguinte natural de quem acabou de criar
  // uma, e sem isso a pessoa teria de procurá-la no quadro.
  const [tarefaNova, setTarefaNova] = useState<string | null>(null);
  const [refTarefa, setRefTarefa] = useState("");
  const [copiado, setCopiado] = useState(false);

  async function acao(fn: () => Promise<unknown>, msgErro: string) {
    setAgindo(true);
    setErro(null);
    try {
      await fn();
      onMudou();
    } catch (e) {
      setErro((e as ApiError).message || msgErro);
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
      `Protocolo: ${envio.protocol}${envio.items.length > 1 ? ` (${item.batch_seq}/${envio.items.length})` : ""} · Recebida em ${new Date(envio.created_at).toLocaleDateString("pt-BR")}`,
      "",
      ...item.answers.map((a) => `${a.label}\n${a.value}\n`),
    ];
    navigator.clipboard.writeText(linhas.join("\n")).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    });
  }

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <strong style={{ fontSize: 14 }}>
          {cat.emoji} {cat.titulo}
          {numeroDaRepeticao(envio.items, item)}
        </strong>
        {cat.prazo && (
          <span className="muted" style={{ fontSize: 11 }}>⏱ {cat.prazo}</span>
        )}
        <Badge tone="soft" size="sm" color={STATUS_COLOR[item.status]} className="ml-auto">
          {STATUS_LABEL[item.status]}
        </Badge>
      </div>

      {erro && <div className="error-box" style={{ marginBottom: 10 }}>{erro}</div>}

      <dl style={{ margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {item.answers.map((a, i) => (
          <div key={i}>
            <dt style={{ fontSize: 11, fontWeight: 600, color: "var(--text-soft)" }}>
              {a.label}
            </dt>
            <dd style={{ margin: "2px 0 0", fontSize: 13, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {/^https?:\/\//.test(a.value) ? (
                <a href={a.value} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
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
        <div className="error-box" style={{ marginTop: 10 }}>
          Justificativa: {item.review_note}
        </div>
      )}
      {item.status === "APPROVED" && item.review_note && (
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          Nota da aprovação: {item.review_note}
        </p>
      )}

      {/* ---- ações ---- */}
      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>

        {/* ⚠️ O ANDAMENTO É UM SELETOR, e não um botão "avançar": volta-se de
            "concluída" para "em andamento" de propósito. Marcar concluída por
            engano é comum, e sem a volta a saída seria pedir para alguém mexer
            no banco. O backend permite os dois sentidos; a tela também. */}
        {aceito && (
          <label
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <span className="muted" style={{ fontSize: 12 }}>
              Situação
            </span>
            <select
              className="input"
              style={{ fontSize: 12, padding: "4px 8px", width: "auto" }}
              aria-label={`Situação de ${cat.titulo}`}
              value={item.status}
              disabled={agindo}
              onChange={(e) =>
                acao(
                  () =>
                    andarSolicitacao(
                      item.id,
                      e.target.value as SolicitacaoStatus
                    ),
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
            caminhos moram na seta. */}
        {item.status === "PENDING" && !rejeitando && (
          <>
            <div ref={menu} style={{ position: "relative", display: "inline-flex" }}>
              <button
                className="btn btn-primary"
                disabled={agindo}
                style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
                onClick={() =>
                  acao(async () => {
                    await aprovarSolicitacao(item.id);
                    const nova = await criarTarefaDaSolicitacao(item.id);
                    setTarefaNova(nova.task_id);
                  }, "Não foi possível aprovar.")
                }
              >
                {agindo ? "…" : "Aprovar e criar tarefa"}
              </button>
              <button
                className="btn btn-primary"
                disabled={agindo}
                aria-label="Outras formas de aprovar"
                aria-expanded={menuAberto}
                style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: "1px solid rgba(255,255,255,.35)", padding: "0 8px" }}
                onClick={() => setMenuAberto((v) => !v)}
              >
                ▾
              </button>
              {menuAberto && (
                <div
                  role="menu"
                  style={{
                    position: "absolute",
                    top: "calc(100% + 4px)",
                    left: 0,
                    zIndex: 20,
                    minWidth: 220,
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: 4,
                    boxShadow: "0 8px 24px rgba(0,0,0,.18)",
                  }}
                >
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
                </div>
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
        {/* ⚠️ CRIAR A TAREFA É O CAMINHO PRINCIPAL agora, e "marcar" virou o
            secundário: quem já criou a tarefa à mão continua podendo registrar,
            mas o fluxo de seis passos (copiar, sair, criar, colar, voltar,
            marcar) deixou de ser o único. */}
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
            {agindo ? "…" : "Criar tarefa"}
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
            onClick={() =>
              acao(
                () => marcarTarefaCriada(item.id, false),
                "Não foi possível desmarcar."
              )
            }
          >
            Desmarcar tarefa
          </button>
        )}

        <button className="btn btn-ghost" style={{ marginLeft: "auto" }} onClick={copiarBriefing}>
          {copiado ? "Copiado ✓" : "Copiar briefing"}
        </button>
      </div>

      {aceito && item.task_created_at && (
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          ✓ Tarefa criada em{" "}
          {new Date(item.task_created_at).toLocaleDateString("pt-BR")}
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
        <p style={{ fontSize: 12, marginTop: 8 }}>
          Tarefa criada.{" "}
          <Link href={`/tarefa/${tarefaNova}`}>Abrir a tarefa</Link>
        </p>
      )}

      {marcandoTarefa && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
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
          <div style={{ display: "flex", gap: 8 }}>
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
              onClick={() => { setMarcandoTarefa(false); setRefTarefa(""); }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {rejeitando && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
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
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn"
              style={{ color: "var(--danger)" }}
              disabled={agindo}
              onClick={() => {
                if (!justificativa.trim()) {
                  setErro("A rejeição exige uma justificativa.");
                  return;
                }
                acao(
                  () => rejeitarSolicitacao(item.id, justificativa.trim()),
                  "Não foi possível rejeitar."
                );
              }}
            >
              {agindo ? "…" : "Confirmar rejeição"}
            </button>
            <button
              className="btn btn-ghost"
              disabled={agindo}
              onClick={() => { setRejeitando(false); setJustificativa(""); }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
