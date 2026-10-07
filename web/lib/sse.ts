// lib/sse.ts
// Ler Server-Sent Events de um texto que chega aos pedaços (Spec 056, fatia G).
//
// ⚠️ POR QUE NÃO O `EventSource` DO NAVEGADOR: ele não manda cabeçalho, e o
// token deste sistema vai no `Authorization` (ele mora no localStorage -- a
// revisão de segurança de 23/09 deixou assim). Pôr o token na URL o deixaria
// nos logs do Traefik. Então o canal é um `fetch` lido em fluxo, e o formato
// SSE é lido aqui -- puro, testado em `lib/__tests__/sse.test.ts`.

export type EventoSSE = { evento: string; dados: string };

/**
 * Os eventos COMPLETOS de `texto` (os que terminam em linha em branco), e o
 * resto -- o pedaço do próximo evento que ainda não chegou inteiro.
 *
 * Segue o essencial da especificação: `event:` dá o nome (padrão "message"),
 * `data:` acumula (várias linhas juntam com "\n"), linha começando com ":" é
 * comentário (o ping do servidor), e `\r\n` vale como `\n`.
 */
export function lerEventos(texto: string): { eventos: EventoSSE[]; resto: string } {
  const normal = texto.replace(/\r\n?/g, "\n");
  const blocos = normal.split("\n\n");
  const resto = blocos.pop() ?? "";
  const eventos: EventoSSE[] = [];
  for (const bloco of blocos) {
    let evento = "message";
    const dados: string[] = [];
    for (const linha of bloco.split("\n")) {
      if (!linha || linha.startsWith(":")) continue;
      const i = linha.indexOf(":");
      const campo = i < 0 ? linha : linha.slice(0, i);
      const valor = i < 0 ? "" : linha.slice(i + 1).replace(/^ /, "");
      if (campo === "event") evento = valor;
      else if (campo === "data") dados.push(valor);
    }
    if (dados.length || evento !== "message") eventos.push({ evento, dados: dados.join("\n") });
  }
  return { eventos, resto };
}

/** Espera entre tentativas de reconectar: 1, 2, 4, 8, 16 s e depois 30. */
export function esperaDeReconexao(tentativa: number): number {
  return Math.min(30_000, 1_000 * 2 ** Math.max(0, tentativa));
}
