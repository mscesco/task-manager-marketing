"use client";
// components/TeamDashboard.tsx
// Os cards da tela inicial do time (Spec 058, fatia D).
//
// ⚠️ SÓ DESENHA. O que aparece e em que ordem é de `lib/teamDashboard.ts`
// (`dashboardLayout`); os números são do servidor, que também decide quem vê
// o quê (card sem permissão chega `null`).
//
// O DESENHO (pedido dela, 14/10, com uma referência de painel em blocos):
// - em cima, QUATRO NÚMEROS GRANDES; o primeiro, a semana, em destaque;
// - embaixo, uma grade de blocos de tamanhos diferentes, SEM BURACO (14/10,
//   ela viu o canto de baixo vazio). No `xl`, quatro colunas:
//
//     gestor:   [círculo ][próximos][atrasadas][minhas ]
//               [círculo ][ carga por pessoa  ][minhas ]
//     operador: [círculo ][      minhas (3)             ]
//               [círculo ][ próximos (2)     ][atrasadas]
//
//   O círculo ocupa duas linhas (o quadrado que ela pediu); "minhas" também,
//   no gestor. Os tamanhos moram em `SPAN`, um lugar só.
//
// ANIMAÇÃO, com o `motion` que o app já usa:
// - barras e colunas crescem por `scaleX`/`scaleY`, e NÃO por largura/altura
//   (web/AGENTS.md §7: só `transform` e `opacity`);
// - o círculo se completa pelo `pathLength` do SVG -- traço, sem layout;
// - trocar o time anima do valor velho para o novo;
// - ⚠️ `useReducedMotion`, e não o bloco do `globals.css`: aquele só alcança
//   animação de CSS (o mesmo cuidado de `FileiraDeReacoes`).

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { motion, useReducedMotion, type Transition } from "motion/react";
import { ArrowUpRight, CalendarClock, ChevronRight } from "lucide-react";
import type { DashboardResponse, DashboardTask } from "@/lib/api";
import { PRIORITY_COLOR, PRIORITY_LABEL } from "@/lib/status";
import {
  WORKLOAD_PREVIEW,
  ageLabel,
  dashboardLayout,
  dueLabel,
  dueTodayCount,
  weekLabel,
  weekPercent,
  weekdayShort,
  type DashboardCard,
  type DashboardTile,
} from "@/lib/teamDashboard";

type Links = {
  /** "Minhas tarefas" com o time da barra (`navHref`). */
  mine: string;
  /** A fila de solicitações com o time da barra. */
  queue: string;
};

export default function TeamDashboard({
  data,
  links,
  personName = null,
  onPickPerson,
}: {
  data: DashboardResponse;
  links: Links;
  /** Filtrado por uma pessoa (14/10): "Minhas" vira dela. */
  personName?: string | null;
  /** Clicar num nome da carga filtra por ele. Ausente = sem o filtro. */
  onPickPerson?: (userId: string) => void;
}) {
  const layout = dashboardLayout(data);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {layout.tiles.map((t, i) => (
          <Tile key={t} tile={t} data={data} links={links} order={i} personName={personName} />
        ))}
      </div>
      <div className="grid grid-flow-row-dense grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {layout.cards.map((c) => (
          <Card
            key={c}
            card={c}
            data={data}
            links={links}
            className={SPAN[layout.manager ? "manager" : "operator"][c]}
            personName={personName}
            onPickPerson={onPickPerson}
          />
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ números
function Tile({
  tile,
  data,
  links,
  order,
  personName,
}: {
  tile: DashboardTile;
  data: DashboardResponse;
  links: Links;
  order: number;
  personName: string | null;
}) {
  // Filtrado por pessoa, os números são DELA (revisão de 15/10): "Minhas
  // atrasadas" e "no time" diziam o contrário.
  const firstName = personName?.split(" ")[0] ?? null;
  switch (tile) {
    case "weekDone":
      return (
        <StatTile
          label="Concluídas na semana"
          value={data.week.done}
          suffix={`de ${data.week.total}`}
          note={weekLabel(data.week.start, data.week.end)}
          highlight
          order={order}
        />
      );
    case "overdue":
      return (
        <StatTile
          label="Atrasadas"
          value={data.overdue_total}
          note={
            firstName
              ? `de ${firstName}, agora`
              : data.overdue_total
                ? "no time, agora"
                : "nenhuma por aqui"
          }
          danger={data.overdue_total > 0}
          order={order}
        />
      );
    case "dueToday":
      return (
        <StatTile label="Vencem hoje" value={dueTodayCount(data)} note="ainda no prazo" order={order} />
      );
    case "queue":
      return data.queue ? (
        <StatTile
          label="Solicitações pendentes"
          value={data.queue.pending}
          note={
            data.queue.pending && data.queue.oldest_at
              ? `a mais antiga chegou ${ageLabel(data.queue.oldest_at, data.today)}`
              : "a fila está em dia"
          }
          href={links.queue}
          order={order}
        />
      ) : null;
    case "myOverdue":
      return (
        <StatTile
          label={firstName ? `Atrasadas de ${firstName}` : "Minhas atrasadas"}
          value={data.mine.overdue_total}
          note={firstName ? "designadas a essa pessoa" : "designadas a você"}
          danger={data.mine.overdue_total > 0}
          href={firstName ? undefined : links.mine}
          order={order}
        />
      );
  }
}

function StatTile({
  label,
  value,
  suffix,
  note,
  href,
  highlight = false,
  danger = false,
  order,
}: {
  label: string;
  value: number;
  suffix?: string;
  note: string;
  href?: string;
  highlight?: boolean;
  danger?: boolean;
  order: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.section
      aria-label={label}
      className={`relative flex min-h-[132px] flex-col justify-between rounded-lg border p-4 ${
        highlight ? "tile-destaque border-transparent" : "border-border bg-surface"
      }`}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0 } : { ...GROW, delay: order * 0.05 }}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className={`m-0 text-md font-semibold ${highlight ? "" : "text-ink-soft"}`}>{label}</h2>
        {href && (
          <Link
            href={href}
            aria-label={`Abrir ${label.toLowerCase()}`}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-ink-soft hover:text-accent"
          >
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        )}
      </div>
      <p className="m-0 mt-3 flex items-baseline gap-1.5">
        <strong className={`text-[40px] font-bold leading-none ${danger ? "text-danger" : ""}`}>
          {value}
        </strong>
        {suffix && <span className={`text-lg ${highlight ? "" : "text-ink-soft"}`}>{suffix}</span>}
      </p>
      {/* ⚠️ Sem `opacity` no destaque: branco a 90% sobre o azul cai abaixo
          de 4.5 (revisão de 15/10). */}
      <p className={`m-0 mt-2 text-sm ${highlight ? "" : "text-ink-faint"}`}>{note}</p>
    </motion.section>
  );
}

// ------------------------------------------------------------------ cards
/** Quanto cada bloco ocupa na grade (ver o desenho no topo). */
const SPAN: Record<"manager" | "operator", Record<DashboardCard, string>> = {
  // ⚠️ O último bloco de cada desenho é LARGO no `md` (duas colunas): sem
  // isso, ele sobrava sozinho numa linha com um buraco ao lado (revisão de
  // 15/10). No `xl` ele volta ao lugar dele.
  manager: {
    weekRing: "md:row-span-2",
    aheadChart: "",
    overdueList: "",
    workload: "md:col-span-2",
    mine: "md:col-span-2 xl:col-span-1 xl:row-span-2",
  },
  operator: {
    weekRing: "md:row-span-2",
    mine: "xl:col-span-3",
    aheadChart: "xl:col-span-2",
    overdueList: "md:col-span-2 xl:col-span-1",
    workload: "",
  },
};

function Card({
  card,
  data,
  links,
  className,
  personName,
  onPickPerson,
}: {
  card: DashboardCard;
  data: DashboardResponse;
  links: Links;
  className: string;
  personName: string | null;
  onPickPerson?: (userId: string) => void;
}) {
  switch (card) {
    case "weekRing":
      return <WeekRingCard data={data} className={className} />;
    case "aheadChart":
      return <AheadChartCard data={data} className={className} />;
    case "overdueList":
      return <OverdueListCard data={data} className={className} />;
    case "workload":
      return data.workload ? (
        <WorkloadCard people={data.workload} className={className} onPick={onPickPerson} />
      ) : null;
    case "mine":
      return (
        <MineCard
          data={data}
          link={links.mine}
          className={className}
          personName={personName}
          tall={className.includes("row-span-2")}
        />
      );
  }
}

function WeekRingCard({ data, className }: { data: DashboardResponse; className: string }) {
  const { done, total, start, end } = data.week;
  const pct = weekPercent(done, total);
  return (
    <CardFrame title="Progresso da semana" subtitle={weekLabel(start, end)} className={className}>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-2">
        <ProgressRing percent={pct} size={188} stroke={18} label="Concluídas na semana" />
        <ul className="m-0 flex list-none flex-wrap justify-center gap-x-4 gap-y-1 p-0 text-sm">
          <li className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-accent" aria-hidden="true" />
            Concluídas <strong>{done}</strong>
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-border" aria-hidden="true" />
            Em aberto <strong>{total - done}</strong>
          </li>
        </ul>
      </div>
      <p className="muted m-0 text-xs">
        {total === 0
          ? "Nenhuma tarefa com prazo nesta semana."
          : "Tarefas com prazo de segunda a domingo; canceladas e bloqueadas ficam fora."}
      </p>
    </CardFrame>
  );
}

/** Colunas verticais, uma por dia -- hoje em destaque. */
function AheadChartCard({ data, className }: { data: DashboardResponse; className: string }) {
  const reduce = useReducedMotion();
  const max = Math.max(1, ...data.due_ahead.map((d) => d.count));
  return (
    <CardFrame title="Próximos 7 dias" subtitle="tarefas que vencem em cada dia" className={className}>
      <ul className="m-0 grid flex-1 list-none grid-cols-7 items-end gap-2 p-0 pt-2">
        {data.due_ahead.map((d, i) => {
          const today = d.date === data.today;
          return (
            <li key={d.date} className="flex flex-col items-center gap-1.5">
              <span className="text-sm font-semibold">{d.count}</span>
              <span
                className="relative block h-28 w-full max-w-[40px] overflow-hidden rounded-full bg-surface-2"
                aria-hidden="true"
              >
                <motion.span
                  className={`absolute inset-0 origin-bottom rounded-full ${today ? "bg-accent" : "bg-accent/45"}`}
                  initial={reduce ? false : { scaleY: 0 }}
                  animate={{ scaleY: d.count / max }}
                  transition={reduce ? { duration: 0 } : { ...GROW, delay: i * STAGGER }}
                />
              </span>
              <span className={`text-xs ${today ? "font-semibold text-accent" : "text-ink-faint"}`}>
                {today ? "Hoje" : weekdayShort(d.date)}
              </span>
            </li>
          );
        })}
      </ul>
    </CardFrame>
  );
}

function OverdueListCard({ data, className }: { data: DashboardResponse; className: string }) {
  return (
    <CardFrame title="Atrasadas" subtitle="as mais antigas primeiro" className={className}>
      {data.overdue_total === 0 ? (
        <Empty>Nenhuma tarefa atrasada.</Empty>
      ) : (
        <Scroll className="max-h-[300px]">
          <TaskList tasks={data.oldest_overdue} today={data.today} danger />
          <More shown={data.oldest_overdue.length} total={data.overdue_total} />
        </Scroll>
      )}
    </CardFrame>
  );
}

function WorkloadCard({
  people,
  className,
  onPick,
}: {
  people: NonNullable<DashboardResponse["workload"]>;
  className: string;
  onPick?: (userId: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const max = Math.max(1, ...people.map((p) => p.open));
  const shown = showAll ? people : people.slice(0, WORKLOAD_PREVIEW);
  return (
    <CardFrame
      title="Tarefas abertas por pessoa"
      subtitle={onPick ? "clique num nome para ver o relatório dela" : "a parte vermelha é a atrasada"}
      className={className}
    >
      {people.length === 0 ? (
        <Empty>Ninguém neste time ainda.</Empty>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {shown.map((p, i) => (
            <li key={p.user_id} className="text-sm">
              <div className="flex items-baseline justify-between gap-2">
                {onPick ? (
                  <button
                    type="button"
                    className="min-w-0 truncate border-0 bg-transparent p-0 text-left text-sm text-ink hover:text-accent hover:underline"
                    onClick={() => onPick(p.user_id)}
                  >
                    {p.name}
                  </button>
                ) : (
                  <span className="min-w-0 truncate">{p.name}</span>
                )}
                {!p.is_active && <span className="shrink-0 text-xs text-ink-faint">(inativo)</span>}
                <span className="shrink-0 text-ink-soft">
                  {p.open}
                  {p.overdue > 0 && (
                    <span className="text-danger">
                      {" "}
                      · {p.overdue} atrasada{p.overdue === 1 ? "" : "s"}
                    </span>
                  )}
                </span>
              </div>
              <Bar
                className="mt-1"
                order={i}
                parts={[
                  { fraction: p.open / max, tone: "accent" },
                  { fraction: p.overdue / max, tone: "danger" },
                ]}
              />
            </li>
          ))}
        </ul>
      )}
      {people.length > WORKLOAD_PREVIEW && (
        <button
          type="button"
          className="btn btn-ghost mt-2 self-start text-sm"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? "Ver menos" : `Ver todos (${people.length})`}
        </button>
      )}
    </CardFrame>
  );
}

function MineCard({
  data,
  link,
  className,
  personName,
  tall,
}: {
  data: DashboardResponse;
  link: string;
  className: string;
  personName: string | null;
  /** Ocupa duas linhas da grade (o desenho do gestor). */
  tall: boolean;
}) {
  const { overdue, overdue_total, due_today, due_today_total } = data.mine;
  // Filtrado por pessoa, o card é DELA (o servidor já mandou as dela).
  const title = personName ? `${personName.split(" ")[0]} para hoje` : "Minhas para hoje";
  return (
    <CardFrame title={title} className={className}>
      {overdue_total + due_today_total === 0 ? (
        <Empty>Nada atrasado nem vencendo hoje.</Empty>
      ) : (
        // No gestor o card ocupa duas linhas, e a área que rola acompanha.
        <Scroll className={tall ? "max-h-[560px]" : "max-h-[300px]"}>
          <div className="flex flex-col gap-3">
          {overdue_total > 0 && (
            <section>
              <p className="m-0 mb-1.5 text-xs font-semibold text-danger">Atrasadas ({overdue_total})</p>
              <TaskList tasks={overdue} today={data.today} danger />
              <More shown={overdue.length} total={overdue_total} />
            </section>
          )}
          {due_today_total > 0 && (
            <section>
              <p className="m-0 mb-1.5 text-xs font-semibold text-ink-soft">
                Vencem hoje ({due_today_total})
              </p>
              <TaskList tasks={due_today} today={data.today} />
              <More shown={due_today.length} total={due_today_total} />
            </section>
          )}
          </div>
        </Scroll>
      )}
      {!personName && (
        <Link href={link} className="mt-auto inline-block pt-2 text-sm text-accent">
          Ver todas as minhas tarefas
        </Link>
      )}
    </CardFrame>
  );
}

// ------------------------------------------------------------------ peças
function CardFrame({
  title,
  subtitle,
  className = "",
  children,
}: {
  title: string;
  subtitle?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`flex flex-col rounded-lg border border-border bg-surface p-4 ${className}`}
      aria-label={title}
    >
      <div className="mb-3">
        <h2 className="m-0 text-md font-semibold">{title}</h2>
        {subtitle && <p className="m-0 text-xs text-ink-faint">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * As tarefas citadas num card (14/10, ela: "achei meio básico, se tiver algum
 * elemento que mostre melhor que são clicáveis").
 *
 * Cada uma é um BLOCO inteiro clicável: título, a coluna onde está (com a cor
 * do quadro), a prioridade e o prazo em pílula -- e a seta à direita, que é o
 * sinal de "abre".
 */
function TaskList({
  tasks,
  today,
  danger = false,
}: {
  tasks: DashboardTask[];
  today: string;
  danger?: boolean;
}) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {tasks.map((t) => (
        <li key={t.id}>
          <Link
            href={`/tarefa/${t.id}`}
            className="group flex items-center gap-2.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-ink no-underline transition-[border-color,background-color] duration-150 hover:border-accent hover:bg-surface-2"
          >
            <span
              className="h-6 w-1 shrink-0 rounded-full"
              style={{ background: t.column_color }}
              aria-hidden="true"
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-base font-semibold group-hover:text-accent">
                {t.title}
              </span>
              <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-ink-faint">
                <span className="flex items-center gap-1">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: t.column_color }}
                    aria-hidden="true"
                  />
                  {t.column_name}
                </span>
                <span aria-hidden="true">·</span>
                <span style={{ color: PRIORITY_COLOR[t.priority] }}>
                  {PRIORITY_LABEL[t.priority] ?? t.priority}
                </span>
                {t.parent_task_id && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>Subtarefa</span>
                  </>
                )}
              </span>
            </span>
            {t.due_date && (
              <span
                className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                  // ⚠️ Borda, e não fundo tingido: o vermelho sobre o
                  // tingido dele mesmo ficava abaixo de 4.5 (revisão de 15/10).
                  danger ? "border border-danger/50 text-danger" : "bg-surface-2 text-ink-soft"
                }`}
              >
                <CalendarClock size={12} aria-hidden="true" />
                {dueLabel(t, today)}
              </span>
            )}
            <ChevronRight
              size={16}
              className="shrink-0 text-ink-faint transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-accent"
              aria-hidden="true"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * A área que ROLA DENTRO do card (14/10, pedido dela: a tela não rola, a
 * lista sim, e dá para ver tudo). `pr-1` deixa a barra de rolagem fora das
 * linhas; `overscroll-contain` impede que chegar ao fim role a página.
 */
function Scroll({ className, children }: { className: string; children: ReactNode }) {
  return (
    <div
      className={`-mr-1 overflow-y-auto overscroll-contain pr-1 ${className}`}
      tabIndex={0}
      aria-label="Lista de tarefas, role para ver todas"
    >
      {children}
    </div>
  );
}

/** O que passou do teto do servidor (50) -- raro, e dito, e não escondido. */
function More({ shown, total }: { shown: number; total: number }) {
  if (total <= shown) return null;
  return <p className="muted m-0 mt-1 text-xs">e mais {total - shown}</p>;
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="muted m-0 text-sm">{children}</p>;
}

// ------------------------------------------------------------------ animação
/** A mola: sem quicar, curta o bastante para não atrasar quem abre todo dia. */
const GROW: Transition = { type: "spring", duration: 0.7, bounce: 0 };
/** Cada barra começa um pouco depois da anterior -- o gráfico "se desenha". */
const STAGGER = 0.04;

/**
 * Uma barra horizontal. Cada parte é uma camada da largura INTEIRA da trilha,
 * escalada de 0 até a fração (`scaleX`, origem à esquerda); as de depois ficam
 * por cima das de antes.
 */
function Bar({
  parts,
  order = 0,
  className = "",
}: {
  parts: { fraction: number; tone: "accent" | "danger" }[];
  order?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <span
      className={`relative block h-2 overflow-hidden rounded-full bg-surface-2 ${className}`}
      aria-hidden="true"
    >
      {parts.map((part, i) => (
        <motion.span
          key={i}
          className={`absolute inset-0 origin-left ${part.tone === "danger" ? "bg-danger" : "bg-accent"}`}
          initial={reduce ? false : { scaleX: 0 }}
          animate={{ scaleX: Math.min(1, Math.max(0, part.fraction)) }}
          transition={reduce ? { duration: 0 } : { ...GROW, delay: order * STAGGER }}
        />
      ))}
    </span>
  );
}

/** O círculo: a trilha inteira e, por cima, o arco do concluído. */
function ProgressRing({
  percent,
  size,
  stroke,
  label,
}: {
  percent: number;
  size: number;
  stroke: number;
  label: string;
}) {
  const reduce = useReducedMotion();
  const r = (size - stroke) / 2;
  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      {/* `-rotate-90`: o arco começa no topo, como um relógio. */}
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden="true"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-surface-2"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          className="stroke-accent"
          initial={reduce ? false : { pathLength: 0 }}
          animate={{ pathLength: percent / 100 }}
          transition={reduce ? { duration: 0 } : { ...GROW, duration: 1 }}
          // ⚠️ 0% com `strokeLinecap="round"` ainda desenharia um pontinho.
          style={{ opacity: percent === 0 ? 0 : 1 }}
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[36px] font-bold leading-none">{percent}%</span>
        <span className="mt-1 text-xs text-ink-faint">concluídas</span>
      </span>
    </div>
  );
}
