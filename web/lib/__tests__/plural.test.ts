// Testes de `lib/plural.ts`.

import { describe, expect, it } from "vitest";

import { plural } from "@/lib/plural";

describe("plural", () => {
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
