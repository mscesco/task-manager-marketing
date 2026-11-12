// Pergunta antes de sair da página enquanto há edição não salva (F5, fechar
// a aba, links da barra lateral). O texto é do navegador; só se pede o aviso
// enquanto houver o que perder.
import { useEffect } from "react";

export function useWarnBeforeUnload(ativo: boolean) {
  useEffect(() => {
    if (!ativo) return;
    function avisar(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = ""; // Chrome antigo só avisa com isto preenchido
    }
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [ativo]);
}
