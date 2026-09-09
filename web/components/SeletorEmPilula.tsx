"use client";
// components/SeletorEmPilula.tsx
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
// ⚠️⚠️ ESCOLHER **NÃO** GRAVA, ao contrário do seletor de coluna. Lá, clicar
// aplica na hora porque errar a coluna se desfaz num clique. Aqui, errar o
// cargo dá alcance no sistema inteiro, em silêncio — então escolher só
// PROPÕE, e quem grava é o Salvar de quem chama. A Camila pediu o Salvar com
// todas as letras em 09/09.
//
// ⚠️ FECHA AO CLICAR FORA com `contains`, e não comparando `e.target ===
// e.currentTarget`: aquele é o padrão do SCRIM de modal, e num painel
// suspenso ele fecharia ao clicar DENTRO da lista. O `TaskDetail` registra a
// mesma distinção — e a Camila já apanhou de um painel meu que não fechava.
//
// ⚠️ GENÉRICO sobre o valor porque a gaveta tem DOIS seletores de permissão:
// o cargo no time e o papel na organização (que inclui "nenhum", e portanto
// não é um `MemberRole`). Dois desenhos diferentes na mesma gaveta seriam
// duas coisas para aprender onde há uma só.

import { useEffect, useRef, useState } from "react";
import Badge from "@/components/Badge";

export type OpcaoDePilula<T extends string> = {
  readonly id: T;
  readonly rotulo: string;
  /**
   * Manda na ÁRVORE inteira, e não só onde está — a bolinha cheia.
   *
   * ⚠️ No seletor de coluna, o ponto colorido é a cor QUE A PESSOA ESCOLHEU
   * para a coluna. Papel não tem cor no produto, e inventar uma seria pintar
   * uma hierarquia que o modelo não tem. O que existe de real para mostrar
   * ali é isto, e espelha `COMMAND_ROLES` de `auth/domain/team_scope.py`.
   */
  readonly comanda?: boolean;
};

export default function SeletorEmPilula<T extends string>({
  valor,
  opcoes,
  desabilitado = false,
  rotulo,
  onEscolher,
}: {
  valor: T;
  opcoes: readonly OpcaoDePilula<T>[];
  desabilitado?: boolean;
  /** Vai no `aria-label` — precisa nomear o TIME, senão há vários iguais. */
  rotulo: string;
  onEscolher: (id: T) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    function onDown(e: MouseEvent) {
      // ⚠️ `wrapRef` PRECISA estar preso ao `<div>` abaixo. Um ref declarado
      // e nunca anexado compila, passa no `tsc` e não fecha nada — foi
      // exatamente o defeito que a Camila viu em 09/09.
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setAberto(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [aberto]);

  const atual = opcoes.find((o) => o.id === valor);

  return (
    <div ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        className="tappable"
        disabled={desabilitado}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        aria-label={rotulo}
        title={desabilitado ? undefined : "Mudar"}
        onClick={() => setAberto((v) => !v)}
        style={{
          border: "none",
          background: "none",
          padding: 0,
          cursor: desabilitado ? "default" : "pointer",
          opacity: desabilitado ? 0.5 : 1,
        }}
      >
        <Badge tone="soft" size="sm" color="var(--accent)">
          {atual?.rotulo ?? "—"}
        </Badge>
      </button>

      {aberto && (
        <div
          role="listbox"
          aria-label={rotulo}
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 30,
            minWidth: 200,
            maxHeight: 280,
            overflowY: "auto",
            padding: 4,
            borderRadius: 10,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow)",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {/* ⚠️ A ORDEM É A DA LISTA RECEBIDA, que vem de `papeisAtribuiveis`
              — do mais alto para o mais baixo. Ordenar alfabeticamente poria
              "Gerente" antes de "Operador" por acaso e obrigaria a LER cada
              linha em vez de mirar. É a mesma razão pela qual a lista de
              prioridade segue a ordem do enum, e não o alfabeto. */}
          {opcoes.map((o) => {
            const selecionada = o.id === valor;
            return (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={selecionada}
                onClick={() => {
                  setAberto(false);
                  onEscolher(o.id);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  border: "none",
                  borderRadius: 8,
                  padding: "6px 10px",
                  fontSize: 13,
                  textAlign: "left",
                  cursor: "pointer",
                  background: selecionada ? "var(--accent-soft)" : "transparent",
                  color: selecionada ? "var(--accent)" : "var(--text)",
                  fontWeight: selecionada ? 600 : 400,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    flexShrink: 0,
                    border: "1.5px solid var(--accent)",
                    background: o.comanda ? "var(--accent)" : "transparent",
                  }}
                />
                <span>{o.rotulo}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
