// vitest.setup.ts -- roda antes de CADA arquivo de teste.
//
// ⚠️⚠️ EXISTE POR CAUSA DO EDITOR DE DESCRIÇÃO (Spec 052, fatia E). O CI de
// 16/09 caiu com "ReferenceError: document is not defined" vindo de
// `@tiptap/core` (`Editor.unmount`), com os 1541 testes verdes.
//
// O MECANISMO: o `useEditor` do Tiptap não destrói o editor quando o componente
// sai da tela -- ele AGENDA a destruição num `setTimeout` de 1 ms (para
// sobreviver ao monta-desmonta-monta do StrictMode). No último teste de um
// arquivo, o `cleanup` desmonta, o arquivo termina, o vitest desmonta o jsdom
// (some o `document`) e SÓ ENTÃO o timer dispara. Numa máquina rápida o timer
// ganha a corrida; no runner do CI, não. Não reproduziu localmente.
//
// A CORREÇÃO: ao fim de cada arquivo, esperar um timer de 10 ms. Timers do Node
// disparam em ordem de vencimento, então TODO timer de 1 ms agendado pelo
// `cleanup` do último teste roda antes deste -- com o jsdom ainda de pé. Custa
// ~10 ms por arquivo, não por teste.
//
// ⚠️ NÃO "CONSERTAR" DESTRUINDO O EDITOR NA HORA no componente: no `next dev` o
// StrictMode desmonta e remonta, e o editor destruído voltaria quebrado.
import { afterAll } from "vitest";

afterAll(async () => {
  await new Promise((pronto) => setTimeout(pronto, 10));
});
