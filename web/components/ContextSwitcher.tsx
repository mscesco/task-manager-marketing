"use client";
// Seletor de contexto no rodapé da barra, acima do nome da pessoa. Só times raiz;
// a regra está em `lib/contextSwitcher.ts`. O painel é `fixed` (via `AnchoredPanel`)
// porque o `<aside>` tem `overflow-y-auto`, e abre para cima.

import { useCallback, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { DUR } from "@/lib/motion";
import { Building2, Check, ChevronDown } from "lucide-react";
import AnchoredPanel, {
  PANEL_ITEM,
  useAnchoredPanel,
} from "@/components/AnchoredPanel";
import type { CurrentUser, Team } from "@/lib/api";
import {
  contextChoice,
  currentContext,
  switcherHref,
} from "@/lib/contextSwitcher";

export default function ContextSwitcher({
  teams,
  me,
  pathname,
  /** A query da URL (`""` vale), para o seletor preservar os outros parâmetros. */
  search,
  /** Tem papel de organização: mostra "Gerenciar a organização". */
  canManageOrg,
  /** A barra está expandida? Retraída, sobra só o ícone. */
  expanded,
  /** Nome da organização: o que o botão mostra quando a tela não tem time na URL. */
  orgName,
}: {
  teams: Team[];
  me: CurrentUser | null;
  pathname: string;
  search: string;
  canManageOrg: boolean;
  expanded: boolean;
  orgName: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const fechar = useCallback(() => setIsOpen(false), []);
  const { anchorRef, panelRef, box } = useAnchoredPanel<HTMLButtonElement>(
    isOpen,
    fechar,
  );

  const escolha = contextChoice(teams, me, canManageOrg);

  if (escolha.kind === "none") return null;

  const base = `flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold ${
    expanded ? "" : "justify-center px-0"
  }`;

  // Rótulo, não link nem botão: com um time só não há para onde ir.
  if (escolha.kind === "label") {
    return (
      <div
        title={`Você está no time ${escolha.team.name}`}
        aria-label={`Time atual: ${escolha.team.name}`}
        className={`${base} text-ink-faint`}
      >
        {/* `Building2`, não `Network`: retraída, a barra mostra só o ícone. */}
        <Building2 size={18} aria-hidden="true" className="shrink-0" />
        {expanded && <span className="truncate">{escolha.team.name}</span>}
      </div>
    );
  }

  const { label: rotulo, activeRootId } = currentContext(
    pathname,
    teams,
    orgName,
  );

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        // Retraída, o botão é só ícone: o nome vai no `aria-label`.
        aria-label={`${rotulo} — trocar de time`}
        title={`Você está em ${rotulo}. Trocar de time`}
        onClick={() => setIsOpen((v) => !v)}
        className={`${base} text-ink-soft hover:bg-surface-2`}
      >
        <Building2 size={18} aria-hidden="true" className="shrink-0" />
        {expanded && (
          <>
            <span className="min-w-0 flex-1 truncate text-left">{rotulo}</span>
            <motion.span
              className="inline-flex shrink-0"
              animate={{ rotate: isOpen ? 180 : 0 }}
              transition={{ type: "spring", duration: DUR[3], bounce: 0 }}
            >
              <ChevronDown size={15} aria-hidden="true" />
            </motion.span>
          </>
        )}
      </button>

      {/* `AnimatePresence` permite a saída animada. */}
      <AnimatePresence>
        {isOpen && box && (
          <AnchoredPanel
            box={box}
            panelRef={panelRef}
            role="menu"
            aria-label="Times"
            minWidth={248}
          >
            {escolha.roots.length === 0 && (
              <div className="muted px-2 py-2 text-xs">Nenhum time ainda.</div>
            )}

            {escolha.roots.map((t) => (
              <SwitcherItem
                key={t.id}
                href={switcherHref(pathname, search, t.id)}
                label={t.name}
                // De `currentContext`: num subtime ou no quadro, o ✓ fica na raiz.
                active={activeRootId === t.id}
              />
            ))}

            {escolha.canManageOrg && (
              <>
                {/* Separa navegar (acima) de administrar (abaixo). */}
                <motion.div
                  variants={PANEL_ITEM}
                  className="my-1.5 border-t border-border"
                />
                <SwitcherItem
                  href="/organizacao"
                  label="Gerenciar a organização"
                  active={pathname === "/organizacao"}
                />
              </>
            )}
          </AnchoredPanel>
        )}
      </AnimatePresence>
    </>
  );
}

function SwitcherItem({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <motion.div variants={PANEL_ITEM}>
      {/* `<a href>`, não `<Link>`: a navegação do app é recarga total. */}
      <a
        href={href}
        role="menuitem"
        aria-current={active ? "true" : undefined}
        className={`flex min-h-9 items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium ${
          active ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-surface-2"
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {active && <Check size={14} aria-hidden="true" className="shrink-0" />}
      </a>
    </motion.div>
  );
}
