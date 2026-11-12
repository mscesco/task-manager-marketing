// Avisar antes de sair com alteração não salva: F5 e a barra lateral (que
// recarrega a página) perderiam o que está sendo editado em silêncio.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";

import { useWarnBeforeUnload } from "@/lib/useWarnBeforeUnload";

afterEach(cleanup);

function sair(): boolean {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented; // true = o navegador pergunta
}

describe("useWarnBeforeUnload", () => {
  it("pergunta só enquanto há o que perder", () => {
    const { rerender, unmount } = renderHook(({ ativo }) => useWarnBeforeUnload(ativo), {
      initialProps: { ativo: false },
    });
    expect(sair()).toBe(false);
    rerender({ ativo: true });
    expect(sair()).toBe(true);
    rerender({ ativo: false });
    expect(sair()).toBe(false);
    rerender({ ativo: true });
    unmount();
    expect(sair()).toBe(false); // desmontou: não fica ouvinte para trás
  });
});
