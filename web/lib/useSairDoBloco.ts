// web/lib/useSairDoBloco.ts
// =====================================================================
// "Saiu do bloco em edição" -- clicou fora dele, ou levou o foco (Tab) para
// fora dele. Usado pela descrição e pelos links da tarefa, que SALVAM ao sair
// (Spec 052, fatia D; o gesto do Trello que ela pediu).
//
// ⚠️ POR QUE NÃO O `onBlur` DO CAMPO. O bloco tem mais de um foco possível
// (o texto, "Salvar", "Cancelar", as setas dos links). Um blur do campo para
// "Cancelar" não é sair -- e no Safari clicar num botão NÃO lhe dá foco, então
// o `relatedTarget` chega `null` e "Cancelar" salvaria antes de cancelar.
//
// Por isso são dois sinais, e nenhum deles depende de o botão receber foco:
//   - `mousedown` no documento, FORA do bloco (o clique);
//   - `focusout` do bloco com destino conhecido FORA dele (o Tab).
// `focusout` com destino `null` (trocar de janela, clicar em área sem foco)
// NÃO conta -- o clique já foi contado pelo `mousedown`, e trocar de janela
// não é desistir nem confirmar.
//
// ⚠️ OS DOIS PODEM DISPARAR NO MESMO GESTO (clicar num campo de fora gera os
// dois). Quem usa precisa ser idempotente -- os componentes guardam "já
// confirmei" numa ref.
// =====================================================================
import { useEffect, useRef, type RefObject } from "react";

export function useSairDoBloco(
  bloco: RefObject<HTMLElement | null>,
  ativo: boolean,
  aoSair: () => void,
) {
  // A função muda a cada render (ela fecha sobre o rascunho); a ref evita
  // reinstalar os ouvintes a cada tecla.
  const aoSairRef = useRef(aoSair);
  useEffect(() => {
    aoSairRef.current = aoSair;
  }, [aoSair]);

  useEffect(() => {
    const el = bloco.current;
    if (!ativo || !el) return;
    function aoPressionar(e: MouseEvent) {
      if (!el!.contains(e.target as Node)) aoSairRef.current();
    }
    function aoPerderFoco(e: FocusEvent) {
      const destino = e.relatedTarget as Node | null;
      if (destino && !el!.contains(destino)) aoSairRef.current();
    }
    document.addEventListener("mousedown", aoPressionar);
    el.addEventListener("focusout", aoPerderFoco);
    return () => {
      document.removeEventListener("mousedown", aoPressionar);
      el.removeEventListener("focusout", aoPerderFoco);
    };
  }, [bloco, ativo]);
}
