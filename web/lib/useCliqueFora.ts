// =====================================================
// useFecharAoClicarFora -- clicar fora fecha; ARRASTAR pra fora nao
// -----------------------------------------------------
// O BUG QUE ISTO RESOLVE (reportado 2026-07-31, com captura):
// selecionar texto dentro do modal -- descricao da tarefa, campo de
// comentario, qualquer coisa -- arrastando o mouse ate soltar FORA do card
// fechava o modal. No `TaskModal` isso apagava o formulario inteiro sem
// perguntar nada.
//
// POR QUE ACONTECIA: o scrim tinha `onClick={fechar}` e o card tinha
// `onClick={(e) => e.stopPropagation()}`. O `stopPropagation` parece resolver,
// e resolve o clique normal -- mas o evento `click` do DOM nao dispara no
// elemento clicado: dispara no ANCESTRAL COMUM do alvo do `mousedown` com o
// alvo do `mouseup`. Apertando dentro e soltando fora, esse ancestral comum e
// o proprio scrim. O clique nunca passa pelo card, entao o `stopPropagation`
// dele nunca roda, e o scrim fecha.
//
// A REGRA CERTA: so e "clique fora" quando o botao foi PRESSIONADO fora E
// SOLTO fora. Os quatro casos estao na tabela do arquivo de teste.
//
// FRONTEIRA (Spec 027): mora em `lib/` porque e decisao, nao desenho -- e
// porque sao TRES modais com o mesmo defeito (TaskDetail, TaskModal e o
// `Modal` de `app/times`). Tres copias da regra seriam tres chances de
// consertar so duas.
// =====================================================
import { useCallback, useRef } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

/**
 * Decide se o clique fecha. Pura de proposito: e a tabela-verdade inteira
 * do comportamento, e o teste bate nela sem precisar de DOM.
 *
 *   pressionouFora | soltouFora | fecha?
 *   ---------------|------------|-------
 *   sim            | sim        | SIM   -- clique fora de verdade
 *   nao            | sim        | nao   -- selecionou texto dentro e soltou fora
 *   sim            | nao        | nao   -- comecou fora e soltou dentro
 *   nao            | nao        | nao   -- clique dentro
 */
export function deveFecharNoClique(
  pressionouFora: boolean,
  soltouFora: boolean
): boolean {
  return pressionouFora && soltouFora;
}

/**
 * Handlers para espalhar no elemento do SCRIM (o fundo escuro).
 *
 * ⚠️ Depende de o scrim ser o `currentTarget`: a comparacao
 * `target === currentTarget` e o que distingue "o ponteiro estava no fundo"
 * de "estava em qualquer coisa dentro do card". Espalhar isto no card, e nao
 * no scrim, inverte a regra em silencio.
 */
export function useFecharAoClicarFora(onFechar: () => void) {
  const pressionouFora = useRef(false);
  const soltouFora = useRef(false);

  const onMouseDown = useCallback((e: ReactMouseEvent) => {
    pressionouFora.current = e.target === e.currentTarget;
  }, []);

  const onMouseUp = useCallback((e: ReactMouseEvent) => {
    soltouFora.current = e.target === e.currentTarget;
  }, []);

  const onClick = useCallback(() => {
    const fecha = deveFecharNoClique(pressionouFora.current, soltouFora.current);
    // Zera SEMPRE, inclusive quando nao fecha: sem isto um arraste que sobrou
    // marcado deixaria o proximo clique fechar por herana do anterior.
    pressionouFora.current = false;
    soltouFora.current = false;
    if (fecha) onFechar();
  }, [onFechar]);

  return { onMouseDown, onMouseUp, onClick };
}
