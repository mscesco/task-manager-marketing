"use client";
// /solicitacoes — fila de triagem agrupada por ENVIO.
//
// UM CARD POR SUBMISSÃO, não por demanda: quem preenche o formulário
// escolhendo 4 categorias gerava 4 cards soltos, e ninguém enxergava que
// eram da mesma pessoa. O card fechado mostra quem pediu + a lista do que
// pediu; abrindo, aparece seção por seção.
//
// A aprovação continua sendo POR SEÇÃO (aprovar a arte, rejeitar a
// divulgação). O agrupamento é só de visualização.
//
// "Tarefa criada" é autodeclarado — ninguém verifica. O valor está no
// contrário: o filtro "Aprovadas sem tarefa" mostra o que foi aceito e
// nunca virou tarefa. Sem esse filtro, a marcação seria decorativa.

import { useCallback, useEffect, useState } from "react";
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
  type SolicitacaoFiltro,
  type SolicitacaoStatus,
  STATUS_ACEITOS,
} from "@/lib/api";
import { rotuloDaCategoria } from "@/lib/rotuloDaCategoria";

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

type Filtro = SolicitacaoFiltro | "ALL";

// Spec 025/D6: dez ENVIOS por página. O card é agrupado e traz as
// respostas de todas as seções, então dez já enchem a tela (R4).
const TAMANHO_PAGINA = 10;

export default function SolicitacoesPage() {
  return (
    <AppShell>
      <Solicitacoes />
    </AppShell>
  );
}

function Solicitacoes() {
  const [filtro, setFiltro] = useState<Filtro>("PENDING");
  const [pagina, setPagina] = useState(1);
  const [envios, setEnvios] = useState<Batch[] | null>(null);
  const [totalEnvios, setTotalEnvios] = useState(0);
  const [pendentes, setPendentes] = useState(0);
  const [semTarefa, setSemTarefa] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [semAcesso, setSemAcesso] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const r = await listarEnvios({
        ...(filtro === "ALL" ? {} : { filtro: filtro as SolicitacaoFiltro }),
        page: pagina,
        size: TAMANHO_PAGINA,
      });
      setEnvios(r.items);
      setTotalEnvios(r.total);
      setPendentes(r.pending_total);
      setSemTarefa(r.approved_without_task_total);
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
  }, [filtro, pagina]);

  useEffect(() => {
    setEnvios(null);
    carregar();
  }, [carregar]);

  // Trocar de filtro reinicia a paginação: manter a página 3 ao passar de
  // "Todas" para "Pendentes" costuma cair numa página que não existe mais.
  useEffect(() => {
    setPagina(1);
  }, [filtro]);

  if (semAcesso) {
    return (
      <EmptyState
        title="Você não tem acesso às solicitações"
        description="A fila de solicitações é do time principal — apenas administradores e gestores podem visualizá-la. Se você precisa acompanhar uma demanda, fale com o time de marketing."
      />
    );
  }

  const FILTROS: { valor: Filtro; label: string; contador?: number }[] = [
    { valor: "PENDING", label: "Pendentes", contador: pendentes },
    { valor: "SEM_TAREFA", label: "Aprovadas sem tarefa", contador: semTarefa },
    { valor: "APPROVED", label: "Aprovadas" },
    { valor: "IN_PROGRESS", label: "Em andamento" },
    { valor: "DONE", label: "Concluídas" },
    { valor: "REJECTED", label: "Rejeitadas" },
    { valor: "ALL", label: "Todas" },
  ];

  return (
    <div>
      <PageHeader
        title="Solicitações"
        count={
          pendentes > 0
            ? `${pendentes} demanda${pendentes > 1 ? "s" : ""} pendente${pendentes > 1 ? "s" : ""}`
            : undefined
        }
        actions={
          <a
            className="btn btn-ghost ml-auto"
            href="/solicitar"
            target="_blank"
            rel="noreferrer"
            title="Abrir o formulário público em nova aba"
          >
            Ver formulário público ↗
          </a>
        }
      />

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {FILTROS.map((f) => (
          <button
            key={f.valor}
            className="btn"
            onClick={() => setFiltro(f.valor)}
            style={
              filtro === f.valor
                ? { borderColor: "var(--accent)", color: "var(--accent)", fontWeight: 600 }
                : f.valor === "SEM_TAREFA" && (f.contador ?? 0) > 0
                  ? { borderColor: "#d97706", color: "#d97706" }
                  : undefined
            }
          >
            {f.label}
            {f.contador !== undefined && f.contador > 0 ? ` (${f.contador})` : ""}
          </button>
        ))}
      </div>

      {filtro === "SEM_TAREFA" && semTarefa > 0 && (
        <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
          Demandas aprovadas que ninguém marcou como tarefa criada. Se já viraram
          tarefa, marque abaixo — senão elas somem de vista até o solicitante
          cobrar.
        </p>
      )}

      {erro && <div className="error-box" style={{ marginBottom: 16 }}>{erro}</div>}
      {envios === null && <p className="muted">Carregando…</p>}

      {envios !== null && envios.length === 0 && !erro && (
        <EmptyState
          title="Nenhum envio aqui"
          description={
            filtro === "PENDING"
              ? "Quando alguém enviar o formulário público, o pedido aparece nesta fila."
              : filtro === "SEM_TAREFA"
                ? "Toda demanda aprovada já foi marcada como tarefa criada."
                : "Nada com este filtro por enquanto."
          }
        />
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {envios?.map((envio) => (
          <CardEnvio
            key={envio.batch_id}
            envio={envio}
            aberto={aberto === envio.batch_id}
            onToggle={() =>
              setAberto(aberto === envio.batch_id ? null : envio.batch_id)
            }
            onMudou={carregar}
          />
        ))}
      </div>

      <Paginacao
        pagina={pagina}
        total={totalEnvios}
        onIr={(p) => {
          setPagina(p);
          setAberto(null); // card aberto de outra página não faz sentido
          window.scrollTo({ top: 0 });
        }}
      />
    </div>
  );
}

/** Navegação de páginas. `total` conta ENVIOS, não demandas (R5). */
function Paginacao({
  pagina,
  total,
  onIr,
}: {
  pagina: number;
  total: number;
  onIr: (p: number) => void;
}) {
  const paginas = Math.max(1, Math.ceil(total / TAMANHO_PAGINA));
  if (total === 0) return null;

  const primeiro = (pagina - 1) * TAMANHO_PAGINA + 1;
  const ultimo = Math.min(pagina * TAMANHO_PAGINA, total);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        marginTop: 20,
        flexWrap: "wrap",
      }}
    >
      <span className="muted" style={{ fontSize: 12 }}>
        {/* rótulo explícito: "envios", porque pending_total conta demandas */}
        Envios {primeiro}–{ultimo} de {total}
      </span>
      {paginas > 1 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            className="btn"
            onClick={() => onIr(pagina - 1)}
            disabled={pagina <= 1}
          >
            ← Anterior
          </button>
          <span className="muted" style={{ fontSize: 12 }}>
            {pagina} / {paginas}
          </span>
          <button
            className="btn"
            onClick={() => onIr(pagina + 1)}
            disabled={pagina >= paginas}
          >
            Próxima →
          </button>
        </div>
      )}
    </div>
  );
}

/** Card fechado: quem pediu + tópicos do que pediu. Aberto: seção por seção. */
function CardEnvio({
  envio,
  aberto,
  onToggle,
  onMudou,
}: {
  envio: Batch;
  aberto: boolean;
  onToggle: () => void;
  onMudou: () => void;
}) {
  const pendentes = envio.items.filter((i) => i.status === "PENDING").length;
  const semTarefa = envio.items.filter(
    (i) => i.status === "APPROVED" && !i.task_created_at
  ).length;

  return (
    <Card className="p-4">
      {/* ---------- cabeçalho: o solicitante ---------- */}
      <div
        className="tappable"
        onClick={onToggle}
        style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}
      >
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>
            {envio.requester_name}
          </div>
          {/* ⚠️ `filter(Boolean)` E NAO SEPARADOR FIXO. Desde a fatia G,
              `requester_department` e `requester_polo` podem ser `null` -- em
              JSX o `null` some, mas o `·` e o `/` FICAM, e o card mostrava
              "maria@x.ex ·  / ". Achado pela revisão de 31/08.

              ⚠️ E OS DOIS SEPARADORES SÃO DIFERENTES DE PROPÓSITO: `·` separa
              o e-mail do lugar, `/` separa área de polo. Na primeira correção
              eu juntei tudo com `·` e mudei o desenho sem ninguém pedir -- a
              Camila mandou voltar. O defeito era o separador ÓRFÃO, não a
              escolha dele. */}
          <div className="muted" style={{ fontSize: 12 }}>
            {[
              envio.requester_email,
              [envio.requester_department, envio.requester_polo]
                .filter(Boolean)
                .join(" / "),
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
            Protocolo <strong>{envio.protocol}</strong> ·{" "}
            {new Date(envio.created_at).toLocaleDateString("pt-BR")} ·{" "}
            {envio.items.length} demanda{envio.items.length > 1 ? "s" : ""}
          </div>

          {/* Tópicos do que foi pedido — visível sem abrir o card. */}
          <ul
            style={{
              margin: "10px 0 0",
              paddingLeft: 18,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {envio.items.map((item) => {
              const cat = rotuloDaCategoria(item);
              return (
                <li key={item.id} style={{ fontSize: 13 }}>
                  <span style={{ marginRight: 6 }}>{cat.emoji}</span>
                  <strong>{cat.titulo}</strong>
                  {": "}
                  <span className="muted">{item.summary}</span>{" "}
                  <Badge tone="soft" size="sm" color={STATUS_COLOR[item.status]}>
                    {STATUS_LABEL[item.status]}
                  </Badge>
                  {item.status === "APPROVED" && (
                    <span
                      style={{
                        fontSize: 11,
                        marginLeft: 6,
                        color: item.task_created_at ? "#16a34a" : "#d97706",
                      }}
                    >
                      {item.task_created_at ? "✓ tarefa criada" : "⚠ sem tarefa"}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
          {pendentes > 0 && (
            <Badge tone="soft" size="sm" color={STATUS_COLOR.PENDING}>
              {pendentes} pendente{pendentes > 1 ? "s" : ""}
            </Badge>
          )}
          {semTarefa > 0 && (
            <Badge tone="soft" size="sm" color="#d97706">
              {semTarefa} sem tarefa
            </Badge>
          )}
          <span className="muted" style={{ fontSize: 11 }}>
            {aberto ? "▲ fechar" : "▼ abrir seções"}
          </span>
        </div>
      </div>

      {/* ---------- aberto: seção por seção ---------- */}
      {aberto && (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="muted" style={{ fontSize: 12 }}>
            Contato:{" "}
            {[envio.requester_email, envio.requester_phone]
              .filter(Boolean)
              .join(" · ")}
          </div>
          {envio.items.map((item) => (
            <SecaoDemanda
              key={item.id}
              envio={envio}
              item={item}
              onMudou={onMudou}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

/** Uma demanda do envio: briefing completo + triagem independente. */
function SecaoDemanda({
  envio,
  item,
  onMudou,
}: {
  envio: Batch;
  item: BatchItem;
  onMudou: () => void;
}) {
  const cat = rotuloDaCategoria(item);
  const aceito = STATUS_ACEITOS.includes(item.status);
  const [erro, setErro] = useState<string | null>(null);
  const [agindo, setAgindo] = useState(false);
  const [rejeitando, setRejeitando] = useState(false);
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
      `[${cat.titulo}] ${item.summary}`,
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
      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <button className="btn" onClick={copiarBriefing}>
          {copiado ? "Copiado ✓" : "Copiar briefing"}
        </button>

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

        {item.status === "PENDING" && !rejeitando && (
          <>
            <button
              className="btn btn-primary"
              disabled={agindo}
              onClick={() =>
                acao(() => aprovarSolicitacao(item.id), "Não foi possível aprovar.")
              }
            >
              {agindo ? "…" : "Aprovar"}
            </button>
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
