"use client";
// components/PillSelect.tsx
// O seletor de permissão — Spec 047, revisão de 09/09.
//
// ⚠️⚠️ MESMA FORMA DO SELETOR DE COLUNA E DE PRIORIDADE do detalhe de tarefa
// (`TaskDetail.tsx`), por pedido da Camila: *"o seletor de permissões quero
// igual o seletor que tem no detalhe de tarefa"*. Pílula que abre um painel
// suspenso, opções com `role="option"`, a atual destacada em `--accent-soft`.
//
// ⚠️ E ISSO NÃO É SÓ ESTÉTICA. Era um `<select>` nativo, e um `<select>` no
// meio de uma gaveta de administração se parece com um campo de formulário —
// algo que você preenche e depois envia. A pílula se parece com o que É: o
// valor atual, clicável. É o mesmo argumento que fez a pílula virar controle
// na Spec 039 (F6).
//
// ⚠️⚠️ ESCOLHER **NÃO** GRAVA por conta própria: ele só devolve a escolha.
// No seletor de coluna, clicar aplica na hora porque errar a coluna se desfaz
// num clique; aqui errar o cargo dá alcance no sistema inteiro, em silêncio.
// Quem chama decide se propõe (com Salvar) ou aplica.
//
// ⚠️⚠️ O PAINEL ERA `absolute` E NASCIA RECORTADO. As gavetas têm
// `overflow-y-auto`, então o painel do seletor de papel da organização
// aparecia cortado e deslocado para fora da gaveta — *"o seletor de papéis da
// organização ficou bugado"*. Agora ele usa `AnchoredPanel`, que é `fixed`,
// mede o gatilho e anima a entrada E a saída.

import { useCallback, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";
import Badge from "@/components/Badge";
import AnchoredPanel, {
  PANEL_ITEM,
  useAnchoredPanel,
} from "@/components/AnchoredPanel";

export type PillOption<T extends string> = {
  readonly id: T;
  readonly label: string;
  /**
   * Manda na ÁRVORE inteira, e não só onde está — a bolinha cheia.
   *
   * ⚠️ No seletor de coluna, o ponto colorido é a cor QUE A PESSOA ESCOLHEU
   * para a coluna. Papel não tem cor no produto, e inventar uma seria pintar
   * uma hierarquia que o modelo não tem. O que existe de real para mostrar
   * ali é isto, e espelha `COMMAND_ROLES` de `auth/domain/team_scope.py`.
   */
  readonly commands?: boolean;
};

export default function PillSelect<T extends string>({
  value,
  options,
  disabled = false,
  label,
  onSelect,
}: {
  value: T;
  options: readonly PillOption<T>[];
  disabled?: boolean;
  /** Vai no `aria-label` — precisa nomear o TIME, senão há vários iguais. */
  label: string;
  onSelect: (id: T) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const fechar = useCallback(() => setIsOpen(false), []);
  const { anchorRef, panelRef, box } = useAnchoredPanel<HTMLButtonElement>(
    isOpen,
    fechar,
  );

  const atual = options.find((o) => o.id === value);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="tappable"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={label}
        title={disabled ? undefined : "Mudar"}
        onClick={() => setIsOpen((v) => !v)}
        style={{
          border: "none",
          background: "none",
          padding: 0,
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <Badge tone="soft" size="sm" color="var(--accent)">
          {atual?.label ?? "—"}
        </Badge>
      </button>

      {/* ⚠️ `AnimatePresence` é o que permite a SAÍDA animada: sem ele o React
          desmonta o nó na hora e o `exit` nunca roda. Abrir suave e sumir seco
          é pior do que não animar. */}
      <AnimatePresence>
        {isOpen && box && (
          <AnchoredPanel
            box={box}
            panelRef={panelRef}
            aria-label={label}
            minWidth={200}
          >
            {/* ⚠️ A ORDEM É A DA LISTA RECEBIDA, que vem de `papeisAtribuiveis`
                — do mais alto para o mais baixo. Ordenar alfabeticamente poria
                "Gerente" antes de "Operador" por acaso e obrigaria a LER cada
                linha em vez de mirar. É a mesma razão pela qual a lista de
                prioridade segue a ordem do enum, e não o alfabeto. */}
            {options.map((o) => {
              const selecionada = o.id === value;
              return (
                <motion.div key={o.id} variants={PANEL_ITEM}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selecionada}
                    onClick={() => {
                      setIsOpen(false);
                      onSelect(o.id);
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] ${
                      selecionada
                        ? "bg-accent-soft font-semibold text-accent"
                        : "text-ink-soft hover:bg-surface-2"
                    }`}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 999,
                        flexShrink: 0,
                        border: "1.5px solid var(--accent)",
                        background: o.commands ? "var(--accent)" : "transparent",
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {selecionada && (
                      <Check size={14} aria-hidden="true" className="shrink-0" />
                    )}
                  </button>
                </motion.div>
              );
            })}
          </AnchoredPanel>
        )}
      </AnimatePresence>
    </>
  );
}
