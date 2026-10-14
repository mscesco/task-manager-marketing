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
// - embaixo, uma grade de blocos de tamanhos diferentes: o círculo da semana
//   GRANDE e quadrado (ocupa duas linhas), os próximos 7 dias em colunas, a
//   carga por pessoa larga. `grid-flow-row-dense` deixa o navegador encaixar
//   os blocos sem buraco.
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
import { ArrowUpRight } from "lucide-react";
import type { DashboardResponse, DashboardTask } from "@/lib/api";
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

export default function TeamDashboard({ data, links }: { data: DashboardResponse; links: Links }) {
  const layout = dashboardLayout(data);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {layout.tiles.map((t, i) => (
          <Tile key={t} tile={t} data={data} links={links} order={i} />
        ))}
      </div>
      <div className="grid grid-flow-row-dense grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {layout.cards.map((c) => (
          <Card key={c} card={c} data={data} links={links} wideMine={layout.wideMine} />
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
}: {
  tile: DashboardTile;
  data: DashboardResponse;
  links: Links;
  order: number;
}) {
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
          note={data.overdue_total ? "no time, agora" : "nenhuma por aqui"}
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
          label="Minhas atrasadas"
          value={data.mine.overdue_total}
          note="designadas a você"
          danger={data.mine.overdue_total > 0}
          href={links.mine}
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
      <p className={`m-0 mt-2 text-sm ${highlight ? "opacity-90" : "text-ink-faint"}`}>{note}</p>
    </motion.section>
  );
}

// ------------------------------------------------------------------ cards
function Card({
  card,
  data,
  links,
  wideMine,
}: {
  card: DashboardCard;
  data: DashboardResponse;
  links: Links;
  wideMine: boolean;
}) {
  switch (card) {
    case "weekRing":
      return <WeekRingCard data={data} />;
    case "aheadChart":
      return <AheadChartCard data={data} />;
    case "overdueList":
      return <OverdueListCard data={data} />;
    case "workload":
      return data.workload ? <WorkloadCard people={data.workload} /> : null;
    case "mine":
      return <MineCard data={data} link={links.mine} wide={wideMine} />;
  }
}

function WeekRingCard({ data }: { data: DashboardResponse }) {
  const { done, total, start, end } = data.week;
  const pct = weekPercent(done, total);
  return (
    // ⚠️ O quadrado: duas linhas de altura na grade (`row-span-2`).
    <CardFrame title="Progresso da semana" subtitle={weekLabel(start, end)} className="md:row-span-2">
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
function AheadChartCard({ data }: { data: DashboardResponse }) {
  const reduce = useReducedMotion();
  const max = Math.max(1, ...data.due_ahead.map((d) => d.count));
  return (
    <CardFrame title="Próximos 7 dias" subtitle="tarefas que vencem em cada dia">
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

function OverdueListCard({ data }: { data: DashboardResponse }) {
  return (
    <CardFrame title="Atrasadas" subtitle="as mais antigas primeiro">
      {data.overdue_total === 0 ? (
        <Empty>Nenhuma tarefa atrasada.</Empty>
      ) : (
        <TaskList tasks={data.oldest_overdue} today={data.today} danger />
      )}
    </CardFrame>
  );
}

function WorkloadCard({ people }: { people: NonNullable<DashboardResponse["workload"]> }) {
  const [showAll, setShowAll] = useState(false);
  const max = Math.max(1, ...people.map((p) => p.open));
  const shown = showAll ? people : people.slice(0, WORKLOAD_PREVIEW);
  return (
    <CardFrame
      title="Tarefas abertas por pessoa"
      subtitle="a parte vermelha é a atrasada"
      className="md:col-span-2"
    >
      {people.length === 0 ? (
        <Empty>Ninguém neste time ainda.</Empty>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {shown.map((p, i) => (
            <li key={p.user_id} className="text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate">{p.name}</span>
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

function MineCard({ data, link, wide }: { data: DashboardResponse; link: string; wide: boolean }) {
  const { overdue, overdue_total, due_today, due_today_total } = data.mine;
  return (
    <CardFrame title="Minhas para hoje" className={wide ? "xl:col-span-3" : ""}>
      {overdue_total + due_today_total === 0 ? (
        <Empty>Nada atrasado nem vencendo hoje.</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {overdue_total > 0 && (
            <section>
              <p className="m-0 mb-1 text-xs font-semibold text-danger">Atrasadas ({overdue_total})</p>
              <TaskList tasks={overdue} today={data.today} />
            </section>
          )}
          {due_today_total > 0 && (
            <section>
              <p className="m-0 mb-1 text-xs font-semibold text-ink-soft">
                Vencem hoje ({due_today_total})
              </p>
              <TaskList tasks={due_today} today={data.today} />
            </section>
          )}
        </div>
      )}
      <Link href={link} className="mt-auto inline-block pt-2 text-sm text-accent">
        Ver todas as minhas tarefas
      </Link>
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
        <li key={t.id} className="flex items-baseline justify-between gap-2 text-sm">
          <Link href={`/tarefa/${t.id}`} className="min-w-0 truncate text-ink hover:text-accent">
            {t.title}
          </Link>
          <span className={`shrink-0 text-xs ${danger ? "text-danger" : "text-ink-faint"}`}>
            {dueLabel(t, today)}
          </span>
        </li>
      ))}
    </ul>
  );
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
