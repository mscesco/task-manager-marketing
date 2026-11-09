"use client";

import { MouseSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";

/**
 * Spec 063: os sensores do arraste de card.
 *
 * ⚠️ MOUSE E TOQUE SEPARADOS, e nao `PointerSensor`. Ele exigia
 * `touch-action: none` no card, e no celular o card ocupa quase toda a coluna:
 * encostar o dedo nele impedia rolar. No toque, arrastar pede TOQUE LONGO; o
 * toque curto abre a tarefa e deslizar rola.
 */
export function useSensoresDeArraste() {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );
}
