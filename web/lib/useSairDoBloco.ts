// "Saiu do bloco em edição": clicou fora ou levou o foco (Tab) para fora.
// Usado pela descrição e pelos links da tarefa, que salvam ao sair.
//
// Não usa `onBlur` do campo: o bloco tem vários focos, e no Safari clicar num
// botão não lhe dá foco (o `relatedTarget` chega `null`, e "Cancelar"
// salvaria). Sinais: `mousedown` fora do bloco e `focusout` com destino
// conhecido fora dele; destino `null` não conta. Os dois podem disparar no
// mesmo gesto, então quem usa tem de ser idempotente.
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
