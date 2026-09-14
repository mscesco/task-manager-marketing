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
import { contextChoice, currentContext } from "@/lib/contextSwitcher";

export default function ContextSwitcher({
  teams,
  me,
  pathname,
  /** `area.create` — existe só nos papéis de organização (Spec 046, §4.1). */
  canManageOrg,
  /** A barra está expandida? Retraída, sobra só o ícone. */
  expanded,
  /**
   * O nome da organização — é o que o botão mostra quando a tela não tem área
   * na URL (decisão da Camila, 10/09). Ver `currentContext`.
   */
  orgName,
}: {
  teams: Team[];
  me: CurrentUser | null;
  pathname: string;
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
  // ⚠️⚠️ A REGRA MORA EM `lib/contextSwitcher.ts`, testada. Aqui havia três
  // ternários que decidiam o rótulo no meio do JSX — e o do meio dizia
  // "Trocar de área", que é o que o botão FAZ, não onde a pessoa está.
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
        // ⚠️ O NOME ENTRA NO `aria-label` porque, com a barra retraída, o botão
        // é só um ícone — o leitor de tela não tem de onde tirar o contexto.
        aria-label={`${rotulo} — trocar de time`}
        title={`Você está em ${rotulo}. Trocar de time`}
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
              transition={{ type: "spring", duration: 0.3, bounce: 0 }}
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
            aria-label="Times"
            minWidth={248}
          >
            {escolha.roots.length === 0 && (
              <div className="muted px-2 py-2 text-xs">Nenhum time ainda.</div>
            )}

            {escolha.roots.map((t) => (
              <SwitcherItem
                key={t.id}
                href={`/times/${t.id}`}
                label={t.name}
                // ⚠️ Vem de `currentContext`, e não de comparar o `pathname`
                // com `/times/<id>`: estar num SUBTIME do Marketing (ou no
                // quadro dele) é estar no Marketing, e a comparação crua
                // deixava a lista inteira sem ✓.
                active={activeRootId === t.id}
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
