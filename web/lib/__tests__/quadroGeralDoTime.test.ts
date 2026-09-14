/**
 * `quadroGeralDoTime` -- o quadro geral DE UM TIME.
 *
 * ⚠️ O DEFEITO DE 14/09: uma tarefa criada no quadro geral do Comercial foi
 * salva certa e não apareceu. O `Board.tsx` escolhia "o" quadro geral com um
 * `find` no singular e pegava o do Marketing -- o mais antigo no banco.
 */
import { describe, expect, it } from "vitest";

import { quadroGeralDoTime } from "../coluna";

type Q = { id: string; is_default: boolean; team_id: string };

// ⚠️ O MARKETING VEM PRIMEIRO, como no banco dela (criado em 05/08; o do
// Comercial em 10/09). É exatamente a ordem em que o `find` antigo errava.
const QUADROS: Q[] = [
  { id: "geral-mkt", is_default: true, team_id: "mkt" },
  { id: "avulso-com", is_default: false, team_id: "com" },
  { id: "geral-com", is_default: true, team_id: "com" },
];

describe("quadroGeralDoTime", () => {
  it("⚠️ com dois gerais, devolve o DO TIME pedido -- e não o primeiro da lista", () => {
    expect(quadroGeralDoTime(QUADROS, "com")?.id).toBe("geral-com");
  });

  it("e o outro time devolve o outro geral", () => {
    expect(quadroGeralDoTime(QUADROS, "mkt")?.id).toBe("geral-mkt");
  });

  it("⚠️ quadro AVULSO do time não conta como geral, mesmo vindo antes", () => {
    // O avulso do Comercial está antes do geral dele na lista.
    const soAvulsoAntes: Q[] = [QUADROS[1], QUADROS[2]];
    expect(quadroGeralDoTime(soAvulsoAntes, "com")?.id).toBe("geral-com");
  });

  it("time sem quadro geral: `undefined`, e não o geral de outro time", () => {
    expect(quadroGeralDoTime(QUADROS, "ti")).toBeUndefined();
  });
});
