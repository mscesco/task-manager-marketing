"use client";
// lib/useActiveTeam.tsx
// O time ativo, entregue pela barra às telas — Spec 048, fatia C.
//
// ⚠️⚠️ POR QUE CONTEXTO, E NÃO CADA TELA RESOLVENDO O SEU. Resolver o time
// ativo exige quatro coisas: a query da URL, a árvore de times, quem está
// olhando e a regra de preferência (`activeTeam`). O `AppShell` já tem as
// quatro -- ele buscou `listTeamsAll()` e `getMe()` para desenhar a barra.
//
// Cada uma das cinco telas repetindo isso seria cinco cópias de uma regra de
// navegação e cinco pares de requisições a mais. E cópia de regra de navegação
// é exatamente o que este projeto já pagou três vezes (`rootOf` duas vezes, a
// regra de alcance na Spec 034) -- com o detalhe de que divergir aqui não dá
// tela vermelha: **recorta a tela pelo time errado, com os portões verdes.**
//
// ⚠️ E É LITERALMENTE O NOME DA SPEC: "o time como contexto". A barra é quem
// sabe onde a pessoa está; as telas perguntam.
//
// ⚠️ `null` É RESPOSTA VÁLIDA e significa "ainda não sei" (a árvore de times
// não chegou) ou "não há time" (`kind: "none"`). Toda tela que consome isto
// precisa decidir o que fazer nesse caso -- e a decisão certa é ESPERAR, não
// buscar sem recorte: buscar sem recorte mostra o conteúdo de todos os times
// por um instante, que é o defeito que a spec veio matar, piscando.

import { createContext, useContext } from "react";

import type { ActiveTeam } from "./activeTeam";

/**
 * O que a barra publica.
 *
 * ⚠️ A QUERY INTEIRA VEM JUNTO porque as telas precisam dela para montar links
 * que PRESERVEM os outros parâmetros (o mesmo motivo de `withTeam` existir).
 * `null` = ainda não lida -- ver `teamUrlToWrite`.
 */
export type ActiveTeamContext = {
  readonly active: ActiveTeam | null;
  readonly search: string | null;
  /**
   * O NOME do time ativo, para a tela dizer pelo que recortou.
   *
   * ⚠⚠ ISSO NÃO É ENFEITE, e a §7 da spec o nomeia: *"a tela precisa dizer
   * 'a fila do Marketing está vazia', e não mostrar um vazio sem contexto"*.
   * Uma lista recortada que não diz pelo quê parece a lista inteira -- e quem
   * troca de time e não encontra um item conclui que ele foi apagado.
   *
   * ⚠️ VEM DA BARRA, e não de cada tela buscar a árvore de times: o `AppShell`
   * já tem `listTeamsAll()` na mão. `null` enquanto ela não chegou.
   */
  readonly teamName: string | null;
};

const Ctx = createContext<ActiveTeamContext>({
  active: null,
  search: null,
  teamName: null,
});

export const ActiveTeamProvider = Ctx.Provider;

/**
 * O time ativo desta tela.
 *
 * ⚠️ Fora do `AppShell` devolve `{active: null}` em vez de levantar: o valor
 * padrão do contexto. Uma tela montada sem a barra (um teste, uma rota de
 * autenticação) não deve estourar -- ela só não tem recorte.
 */
export function useActiveTeam(): ActiveTeamContext {
  return useContext(Ctx);
}

/**
 * Atalho para o caso comum: o id do time, ou `null`.
 *
 * ⚠️ `kind: "all"` VIRA `null` AQUI, e isso é uma armadilha se a tela não
 * souber: "todos os times" e "ainda não sei" são coisas diferentes, e só
 * Minhas tarefas oferece "todos". Quem precisa distinguir usa `useActiveTeam()`
 * e lê o `kind`.
 */
export function useActiveTeamId(): string | null {
  const { active } = useActiveTeam();
  return active?.kind === "team" ? active.teamId : null;
}
