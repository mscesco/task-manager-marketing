/**
 * Arrastar por toque e toque longo. Voltar ao `PointerSensor`, ou tirar o
 * `delay`, faz o card prender o dedo no celular, e o jsdom não rola nem
 * arrasta: este teste repete a config de propósito.
 */
import { expect, it, vi } from "vitest";

vi.mock("@dnd-kit/core", () => ({
  MouseSensor: "mouse",
  TouchSensor: "touch",
  useSensor: (sensor: string, opcoes: unknown) => [sensor, opcoes],
  useSensors: (...sensores: unknown[]) => sensores,
}));

const { useSensoresDeArraste } = await import("../useSensoresDeArraste");

it("mouse por distancia, toque por toque longo", () => {
  expect(useSensoresDeArraste()).toEqual([
    ["mouse", { activationConstraint: { distance: 8 } }],
    ["touch", { activationConstraint: { delay: 250, tolerance: 8 } }],
  ]);
});
