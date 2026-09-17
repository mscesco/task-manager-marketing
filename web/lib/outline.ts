/**
 * A geometria do contorno desenhado — Spec 047, revisão de 10/09.
 *
 * FRONTEIRA (Spec 027): decisão mora em `lib/`, sem React. E aqui isso não é
 * formalidade — é a única forma de haver guardião. Em jsdom não há layout:
 * `offsetWidth` é 0, o `<svg>` do `AnimatedOutline` nunca monta, e **nenhum
 * teste de componente consegue olhar o caminho**. Enquanto esta conta vivia
 * dentro do `.tsx`, ela era invisível para os portões — e foi assim que os dois
 * defeitos de 10/09 chegaram à tela juntos:
 *
 *   1. o traço corria EXATAMENTE sobre a caixa, então metade da espessura
 *      caía fora do desenho e era cortada (pior na curva, que encosta na
 *      borda em dois eixos);
 *   2. o raio vinha escrito à mão em cada chamador, e eu errei em três de
 *      sete -- `rounded-lg` aqui é 12px, não 8.
 *
 * O (2) se resolveu lendo o raio do CSS (`AnimatedOutline`). O (1) é esta
 * conta, e ela agora tem teste.
 */

/** Espessura do traço, em pixels. */
export const STROKE_WIDTH = 2;

/**
 * Metade da espessura — o quanto o caminho recua para dentro da caixa.
 *
 * ⚠️ Um traço tem espessura para os DOIS lados da linha. Correndo sobre a
 * borda (`0,0` a `w,h`), 1px fica fora da `viewBox` e o navegador o corta.
 */
export const INSET = STROKE_WIDTH / 2;

/**
 * O caminho da volta, começando e terminando no MEIO DA BASE.
 *
 * ⚠️ As duas pontas coincidem no meio da base porque é lá que o traço para —
 * pedido dela: *"uma linha pequena que corre contornando o card e para
 * embaixo"*. É por isso que é um `<path>` e não um `<rect>`: `rect` começa no
 * canto superior esquerdo e não há como escolher.
 *
 * ⚠️ Sentido anti-horário (para a esquerda primeiro) por nenhuma razão além de
 * escolher um.
 *
 * ⚠️⚠️ O RAIO RECUA JUNTO com a caixa. Recuar a caixa e manter o raio deixaria
 * a curva de dentro mais aberta que a do cartão, e o traço cruzaria a borda no
 * meio do canto — de dentro para fora.
 *
 * @param w largura da superfície, em pixels
 * @param h altura da superfície, em pixels
 * @param r raio da superfície (o do CSS dela), em pixels
 */
export function outlinePath(w: number, h: number, r: number): string {
  const x0 = INSET;
  const y0 = INSET;
  const x1 = w - INSET;
  const y1 = h - INSET;
  // ⚠️ O `max(0, …)` cobre o raio 0 (faixa de lista, que se divide por borda):
  // `0 - INSET` daria -1, e raio negativo num arco de SVG não desenha nada.
  // ⚠️ E os dois `min` cobrem a superfície mais estreita que o próprio raio --
  // um cartão de 10px de altura com raio 12 desenharia arcos maiores que a
  // caixa, e a volta se dobraria sobre si mesma.
  const raio = Math.max(0, Math.min(r - INSET, (x1 - x0) / 2, (y1 - y0) / 2));
  return [
    `M ${(x0 + x1) / 2} ${y1}`,
    `L ${x0 + raio} ${y1}`,
    `A ${raio} ${raio} 0 0 1 ${x0} ${y1 - raio}`,
    `L ${x0} ${y0 + raio}`,
    `A ${raio} ${raio} 0 0 1 ${x0 + raio} ${y0}`,
    `L ${x1 - raio} ${y0}`,
    `A ${raio} ${raio} 0 0 1 ${x1} ${y0 + raio}`,
    `L ${x1} ${y1 - raio}`,
    `A ${raio} ${raio} 0 0 1 ${x1 - raio} ${y1}`,
    `Z`,
  ].join(" ");
}
