// web/lib/useWarnBeforeUnload.ts
// =====================================================================
// Pergunta antes de sair da página enquanto há edição não salva -- F5,
// fechar a aba, e a navegação da barra lateral (que é `<a>`, com recarga).
// `web/AGENTS.md` §4: "Avisar antes de sair com alteração não salva".
//
// ⚠️ O NAVEGADOR ESCREVE A PERGUNTA, não nós: desde 2016 o texto do
// `returnValue` é ignorado e cada navegador mostra o seu. O que importa é
// pedir o aviso (`preventDefault`), e só ENQUANTO houver o que perder --
// ligado sempre, a página perguntaria até para quem não mexeu em nada.
// =====================================================================
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
