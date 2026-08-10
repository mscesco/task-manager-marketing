// Testes de `lib/plural.ts`.
//
// ⚠️ MOVIDOS DE `status.test.ts` NA FATIA 4a (Spec 036 / ADR 0040), junto com
// a funcao. Estavam la porque a funcao estava la; nenhum destes casos tem
// relacao com status.

import { describe, expect, it } from "vitest";

import { plural } from "@/lib/plural";

describe("plural (Spec 031, C7)", () => {
  // Nasceu de um bug em producao: a linha de contadores mostrava
  // "1 canceladas" porque o plural estava cravado no template.
  it("um usa SINGULAR", () => {
    expect(plural(1, "cancelada", "canceladas")).toBe("1 cancelada");
  });
  it("zero usa plural", () => {
    expect(plural(0, "cancelada", "canceladas")).toBe("0 canceladas");
  });
  it("mais de um usa plural", () => {
    expect(plural(2, "cancelada", "canceladas")).toBe("2 canceladas");
    expect(plural(41, "concluída", "concluídas")).toBe("41 concluídas");
  });
});
