"use client";

import { MouseSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";

/**
 * Os sensores do arraste de card. Mouse e toque separados, e não
 * `PointerSensor`, que exige `touch-action: none` e impediria rolar no
 * celular. No toque, arrastar pede toque longo.
 */
export function useSensoresDeArraste() {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );
}
