"use client";
// components/ContextSwitcher.tsx
// O seletor de contexto da barra lateral — Spec 047, revisão de 09/09.
//
// ⚠️⚠️ ELE EXISTE PARA TIRAR "ORGANIZAÇÃO" E "TIMES" DA LISTA DO MENU, e a
// razão é da Camila: *"ela não é para estar no menu junto com projetos, minhas
// tarefas e afins, é outra seção"*. E ela está certa — "Projetos" e "Minhas
// tarefas" são LUGARES DE TRABALHO; a organização e a árvore de times são
// ONDE VOCÊ ESTÁ. Misturar os dois faz a lista crescer sem que nenhum item
// fique mais fácil de achar.
//
// ⚠️ O PAINEL É `fixed`, E NÃO `absolute`, e isso não é preferência: o
// `<aside>` da barra tem `overflow-y-auto` (posto lá em 05/08, para o menu não
// sumir com zoom). Um painel `absolute` dentro dele seria RECORTADO pela
// barra — apareceria pela metade, ou não apareceria. Por isso ele mede o
// gatilho na abertura e se posiciona na viewport.
//
// ⚠️ E POR MEDIR NA ABERTURA, ele FECHA ao rolar ou redimensionar: a medida
// envelhece no primeiro pixel de rolagem, e um painel flutuando longe do
// gatilho é pior que um painel fechado.
//
// ⚠️ FECHA AO CLICAR FORA com `contains`, e não comparando `e.target ===
// e.currentTarget`: aquele é o padrão do SCRIM de modal, e aqui fecharia ao
// clicar DENTRO da lista. Mesma distinção registrada em `TaskDetail` e em
// `PillSelect`.
//
// ⚠️ MORA EM `components/`, então tem guardião — `app/` fica fora do
// `include` do vitest.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Building2, Check, ChevronDown } from "lucide-react";
import type { Team } from "@/lib/api";

/** Uma área com os subtimes dela, já na ordem em que o painel desenha. */
export type SwitcherTree = {
  readonly area: Team;
  readonly subteams: Team[];
};

/**
 * Agrupa a lista plana de times em áreas + subtimes.
 *
 * ⚠️ SÓ DOIS NÍVEIS NO PAINEL, mesmo que a árvore tenha três: um menu com
 * indentação de neto vira um mapa, e mapa não é o que se lê com o mouse
 * parado. O neto se alcança entrando no pai — que é a mesma escolha da visão
 * "Subtimes" da tela de time (`subteamCards`).
 */
export function switcherTrees(teams: readonly Team[]): SwitcherTree[] {
  return teams
    .filter((t) => t.parent_team_id === null)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    .map((area) => ({
      area,
      subteams: teams
        .filter((t) => t.parent_team_id === area.id)
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    }));
}

/** O que o gatilho mostra: onde a pessoa está agora. */
export function contextLabel(
  pathname: string,
  teams: readonly Team[],
): string {
  if (pathname === "/organizacao") return "Organização";
  // ⚠️⚠️ `/times/` É ROTA, e não nome — o rename de 09/09 passou por cima
  // dela e virou `/teams/`, que não casa com rota nenhuma. O seletor parou de
  // reconhecer a tela de time e passou a dizer "Times e organização" em todo
  // lugar, calado. Quem pegou foi o teste; o `tsc` não tem como.
  const m = /^\/times\/([^/]+)/.exec(pathname);
  if (m) {
    const team = teams.find((t) => t.id === m[1]);
    if (team) return team.name;
  }
  // ⚠️ Fora dessas telas o seletor não MENTE dizendo um time: ele diz o que
  // faz. Escolher um nome qualquer aqui (o primeiro time, o time da pessoa)
  // sugeriria um contexto ativo que a tela não tem.
  return "Times e organização";
}

export default function ContextSwitcher({
  teams,
  pathname,
  canManageOrg,
  expanded,
}: {
  teams: Team[];
  pathname: string;
  /** `area.create` — o mesmo gate que a entrada de menu tinha. */
  canManageOrg: boolean;
  /** A barra está expanded? Retraída, sobra só o ícone. */
  expanded: boolean;
}) {
  const [isOpen, setAberto] = useState(false);
  const [caixa, setCaixa] = useState<{ top: number; left: number } | null>(null);
  const gatilhoRef = useRef<HTMLButtonElement>(null);
  const painelRef = useRef<HTMLDivElement>(null);

  const arvores = switcherTrees(teams);
  const label = contextLabel(pathname, teams);

  // ⚠️ `useLayoutEffect` e não `useEffect`: medir depois da PINTURA faria o
  // painel aparecer um quadro no canto (0,0) e saltar para o lugar. Aqui ele
  // já nasce posicionado.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const r = gatilhoRef.current?.getBoundingClientRect();
    if (r) setCaixa({ top: r.bottom + 6, left: r.left });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function onDown(e: MouseEvent) {
      const alvo = e.target as Node;
      if (
        !gatilhoRef.current?.contains(alvo) &&
        !painelRef.current?.contains(alvo)
      ) {
        setAberto(false);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }
    // Ver o bloco no topo: a medida envelhece com a rolagem.
    const fechar = () => setAberto(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    window.addEventListener("resize", fechar);
    window.addEventListener("scroll", fechar, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("resize", fechar);
      window.removeEventListener("scroll", fechar, true);
    };
  }, [isOpen]);

  return (
    <>
      <button
        ref={gatilhoRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label="Times e organização"
        title="Times e organização"
        onClick={() => setAberto((v) => !v)}
        className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-surface-2 ${
          expanded ? "" : "justify-center px-0"
        }`}
      >
        <Building2 size={18} aria-hidden="true" className="shrink-0" />
        {expanded && (
          <>
            <span className="min-w-0 flex-1 truncate text-left">{label}</span>
            {/* A seta gira junto — o mesmo movimento que a pessoa acabou de
                fazer com o clique, devolvido na tela. */}
            <motion.span
              className="inline-flex shrink-0"
              animate={{ rotate: isOpen ? 180 : 0 }}
              transition={{ type: "spring", duration: 0.3, bounce: 0.2 }}
            >
              <ChevronDown size={15} aria-hidden="true" />
            </motion.span>
          </>
        )}
      </button>

      {/* ⚠️ `AnimatePresence` é o que permite a SAÍDA animada: sem ele o React
          desmonta o nó na hora e o `exit` nunca roda. Abrir suave e sumir seco
          é pior do que não animar. */}
      <AnimatePresence>
        {isOpen && caixa && (
          <motion.div
            ref={painelRef}
            role="menu"
            aria-label="Times e organização"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ type: "spring", duration: 0.26, bounce: 0.16 }}
            // ⚠️ A origem da escala é o CANTO DE CIMA À ESQUERDA, que é onde
            // o gatilho está: escalando a partir do centro, o painel cresce
            // também para cima e parece brotar do nada.
            style={{
              position: "fixed",
              top: caixa.top,
              left: caixa.left,
              zIndex: 60,
              transformOrigin: "top left",
              width: 248,
              maxHeight: "min(70vh, 520px)",
              overflowY: "auto",
              borderRadius: 12,
              padding: 6,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              boxShadow: "var(--shadow)",
            }}
          >
            {/* ⚠️ AS LINHAS ENTRAM EM CASCATA (`staggerChildren`), e é o que a
                Camila pediu ao mandar a página de animação. O atraso é de 18ms
                e a lista é curta de propósito: cascata longa vira espera, e o
                menu é justamente o lugar onde ninguém quer esperar. */}
            <motion.div
              initial="fechado"
              animate="aberto"
              variants={{
                isOpen: { transition: { staggerChildren: 0.018 } },
                fechado: {},
              }}
            >
              {arvores.length === 0 && (
                <div className="muted px-2 py-2 text-xs">
                  Nenhuma área ainda.
                </div>
              )}

              {arvores.map(({ area, subteams }) => (
                <div key={area.id}>
                  <SwitcherItem
                    href={`/times/${area.id}`}
                    label={area.name}
                    active={pathname === `/times/${area.id}`}
                    bold
                  />
                  {subteams.map((s) => (
                    <SwitcherItem
                      key={s.id}
                      href={`/times/${s.id}`}
                      label={s.name}
                      active={pathname === `/times/${s.id}`}
                      indented
                    />
                  ))}
                </div>
              ))}

              {canManageOrg && (
                <>
                  {/* ⚠️ A LINHA SEPARA DUAS COISAS DIFERENTES: acima, PARA ONDE
                      IR; abaixo, ADMINISTRAR o conjunto. Sem ela, "Gerenciar a
                      organização" lê-se como só mais um time da lista. */}
                  <motion.div
                    variants={ITEM}
                    className="my-1.5 border-t border-border"
                  />
                  <SwitcherItem
                    href="/organizacao"
                    label="Gerenciar a organização"
                    active={pathname === "/organizacao"}
                  />
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// Cada linha sobe 4px enquanto aparece. Curto: é confirmação de que o menu
// abriu, não um número de dança.
const ITEM = {
  fechado: { opacity: 0, y: -4 },
  isOpen: { opacity: 1, y: 0 },
};

function SwitcherItem({
  href,
  label,
  active,
  bold = false,
  indented = false,
}: {
  href: string;
  label: string;
  active: boolean;
  bold?: boolean;
  indented?: boolean;
}) {
  return (
    <motion.div variants={ITEM}>
      {/* ⚠️ `<a href>` E NÃO `<Link>`: a navegação deste app é recarga total
          (está registrado no topo do `AppShell`, junto do motivo de a barra
          persistir o próprio estado). Misturar os dois faria metade das
          telas recarregar e a outra metade não. */}
      <a
        href={href}
        role="menuitem"
        className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] ${
          indented ? "pl-6" : ""
        } ${bold ? "font-semibold" : "font-medium"} ${
          active ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-surface-2"
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {active && <Check size={14} aria-hidden="true" className="shrink-0" />}
      </a>
    </motion.div>
  );
}
