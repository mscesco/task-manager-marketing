// Roda antes de cada arquivo de teste.
// O `useEditor` do Tiptap agenda a destruição do editor num `setTimeout` de 1 ms;
// no último teste de um arquivo o timer pode disparar depois de o jsdom sair
// ("document is not defined"). Esperar 10 ms ao fim de cada arquivo deixa esses
// timers rodarem antes. Não destruir o editor na hora no componente: o StrictMode
// do `next dev` desmonta e remonta, e ele voltaria quebrado.
import { afterAll } from "vitest";

afterAll(async () => {
  await new Promise((pronto) => setTimeout(pronto, 10));
});
