/**
 * A geometria do contorno animado (`AnimatedOutline`). Mora fora do `.tsx`
 * porque em jsdom não há layout e nenhum teste de componente vê o caminho.
 */

/** Espessura do traço, em pixels. */
export const STROKE_WIDTH = 2;

/**
 * Metade da espessura — o quanto o caminho recua para dentro da caixa.
 *
 * Sobre a borda, metade do traço ficaria fora da `viewBox` e seria cortada.
 */
export const INSET = STROKE_WIDTH / 2;

/**
 * O caminho da volta, começando e terminando no meio da base (onde o traço
 * para; por isso `<path>` e não `<rect>`). O raio recua junto com a caixa,
 * senão o traço cruzaria a borda no canto.
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
  // `max(0, …)`: raio negativo não desenha arco. Os `min`: superfície mais
  // estreita que o raio faria a volta se dobrar.
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
