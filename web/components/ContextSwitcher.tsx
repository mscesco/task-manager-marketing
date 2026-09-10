"use client";
// components/ContextSwitcher.tsx
// Onde você está, no rodapé da barra — Spec 047, revisão de 09/09.
//
// ⚠️⚠️ ELE FICA ACIMA DO NOME DA PESSOA, e não no topo: pedido da Camila, e o
// lugar tem sentido. O rodapé é o bloco do "quem sou eu e onde estou" — nome,
// tema, sair. O topo é a identidade do produto. Eu já pus este componente lá
// em cima uma vez, e ela corrigiu: *"o que eu quis dizer com ele era para
// manter ele ali em cima do nome da pessoa"*.
//
// ⚠️⚠️ ELE SUBSTITUI O "TIME PRINCIPAL" (Spec 039, F3) sendo a outra metade
// dele. A regra combinada em 19/08 e repetida em 09/09:
//
//     uma raiz, sem poder na organização  -> RÓTULO, sem chevron
//     mais de uma raiz, ou administra     -> SELETOR
//
// A primeira metade já existia; o seletor era o pedaço que faltava, e a Spec
// 046 (várias áreas) criou o caso que o exige.
//
// ⚠️⚠️ SÓ TIMES RAIZ, com todas as letras: *"subtimes não são para aparecer
// ali, só times raiz e a opção de gerenciar a organização"*. Ele responde "em
// qual ÁREA eu estou"; subtime é navegação DENTRO da área, e o lugar dela é a
// tela do time.
//
// ⚠️ A DECISÃO MORA EM `lib/contextSwitcher.ts`, testada — aqui só se desenha.
//
// ⚠️ A MECÂNICA DO PAINEL mora em `AnchoredPanel`, compartilhada com os
// seletores de papel e de time: `fixed` (o `<aside>` da barra tem
// `overflow-y-auto` e recortaria um `absolute`), medido na abertura, fechando
// ao rolar, e abrindo PARA CIMA quando não há espaço embaixo — que é sempre o
// caso aqui, porque ele mora no rodapé.

import { useCallback, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Building2, Check, ChevronDown } from "lucide-react";
import AnchoredPanel, {
  PANEL_ITEM,
  useAnchoredPanel,
} from "@/components/AnchoredPanel";
import type { CurrentUser, Team } from "@/lib/api";
import { contextChoice } from "@/lib/contextSwitcher";

export default function ContextSwitcher({
  teams,
  me,
  pathname,
  /** `area.create` — existe só nos papéis de organização (Spec 046, §4.1). */
  canManageOrg,
  /** A barra está expandida? Retraída, sobra só o ícone. */
  expanded,
}: {
  teams: Team[];
  me: CurrentUser | null;
  pathname: string;
  canManageOrg: boolean;
  expanded: boolean;
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

  // ---- RÓTULO -----------------------------------------------------------
  // ⚠️ NÃO É LINK, e não é botão: com uma área só não há para onde ir, e um
  // item clicável que não leva a lugar nenhum é pior que um rótulo. A regra
  // "se parece clicável, tem de ser clicável" vale ao contrário também.
  if (escolha.kind === "label") {
    return (
      <div
        title={`Você está no time ${escolha.team.name}`}
        aria-label={`Time atual: ${escolha.team.name}`}
        className={`${base} text-ink-faint`}
      >
        {/* ⚠️ `Building2` E NÃO `Network`: retraída, a barra mostra só o
            ícone, e os dois viravam o MESMO símbolo em lugares diferentes.
            Achado pela Camila na tela. */}
        <Building2 size={18} aria-hidden="true" className="shrink-0" />
        {expanded && <span className="truncate">{escolha.team.name}</span>}
      </div>
    );
  }

  // ---- SELETOR ----------------------------------------------------------
  const atual = escolha.roots.find((t) => pathname === `/times/${t.id}`);
  const rotulo = atual
    ? atual.name
    : pathname === "/organizacao"
    ? "Organização"
    : // ⚠️ Fora dessas telas ele NÃO MENTE dizendo um time. Escolher um nome
      // qualquer (o primeiro, o da pessoa) sugeriria um contexto ativo que a
      // tela não tem.
      "Trocar de área";

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label="Trocar de área"
        title="Trocar de área"
        onClick={() => setIsOpen((v) => !v)}
        className={`${base} text-ink-soft hover:bg-surface-2`}
      >
        <Building2 size={18} aria-hidden="true" className="shrink-0" />
        {expanded && (
          <>
            <span className="min-w-0 flex-1 truncate text-left">{rotulo}</span>
            {/* A seta gira junto — o mesmo movimento do clique, devolvido. */}
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
          desmonta o nó na hora e o `exit` nunca roda. */}
      <AnimatePresence>
        {isOpen && box && (
          <AnchoredPanel
            box={box}
            panelRef={panelRef}
            role="menu"
            aria-label="Áreas"
            minWidth={248}
          >
            {escolha.roots.length === 0 && (
              <div className="muted px-2 py-2 text-xs">Nenhuma área ainda.</div>
            )}

            {escolha.roots.map((t) => (
              <SwitcherItem
                key={t.id}
                href={`/times/${t.id}`}
                label={t.name}
                active={pathname === `/times/${t.id}`}
              />
            ))}

            {escolha.canManageOrg && (
              <>
                {/* ⚠️ A LINHA SEPARA DUAS COISAS DIFERENTES: acima, PARA ONDE
                    IR; abaixo, ADMINISTRAR o conjunto. Sem ela, "Gerenciar a
                    organização" lê-se como mais uma área. */}
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
      {/* ⚠️ `<a href>` E NÃO `<Link>`: a navegação deste app é recarga total
          (registrado no topo do `AppShell`, junto do motivo de a barra
          persistir o próprio estado). Misturar os dois faria metade das telas
          recarregar e a outra metade não. */}
      <a
        href={href}
        role="menuitem"
        className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] font-medium ${
          active ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-surface-2"
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {active && <Check size={14} aria-hidden="true" className="shrink-0" />}
      </a>
    </motion.div>
  );
}
