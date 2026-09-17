// lib/seguidores.ts
// As regras da tela de SEGUIR uma tarefa (Spec 053, fatia D).
//
// Na tela e "seguir"; no backend a relacao se chama `watcher`.
//
// ⚠️ `lib/` DECIDE e `components/` desenha (Spec 027): o que a lista oferece,
// o que cada pessoa pode fazer e que frase aparece quando falha moram aqui,
// testados como funcao. `components/SeguidoresDaTarefa.tsx` so monta.

/** Uma pessoa na lista de escolha. `inativo` so aparece em quem JA segue. */
export type PessoaOferecida = { id: string; name: string; inativo: boolean };

/**
 * Quem a lista de "Seguidores" oferece, ja filtrado pela busca e em ordem de
 * nome.
 *
 * ⚠️ AS DUAS EXCECOES DOS RESPONSAVEIS, pelo mesmo motivo: desativado e quem
 * nao alcanca a tarefa SAEM da lista -- MENOS quem ja segue. Sem a excecao, a
 * unica forma de tirar essa pessoa (desmarcar a caixa dela) sumiria junto
 * (D11: desativado aparece riscado e da para tira-lo).
 */
export function pessoasOferecidas({
  membros,
  busca,
  inativos,
  foraDoEscopo,
  marcados,
}: {
  membros: Iterable<{ id: string; name: string }>;
  busca: string;
  inativos: ReadonlySet<string>;
  foraDoEscopo: ReadonlySet<string>;
  marcados: readonly string[];
}): PessoaOferecida[] {
  const q = busca.trim().toLowerCase();
  const jaSegue = new Set(marcados);
  return Array.from(membros)
    .map((m) => ({ id: m.id, name: m.name, inativo: inativos.has(m.id) }))
    .filter((m) => !m.inativo || jaSegue.has(m.id))
    .filter((m) => !foraDoEscopo.has(m.id) || jaSegue.has(m.id))
    .filter((m) => (q ? m.name.toLowerCase().includes(q) : true))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export type PermissoesDeSeguidor = {
  /** O botao "Seguir" / "Deixar de seguir" do topo. */
  seguirASiMesmo: boolean;
  /** O `+` da linha e o `×` de cada pessoa que nao e voce. */
  mexerEmOutros: boolean;
};

/**
 * O que a pessoa pode fazer com os seguidores desta tarefa.
 *
 * ⚠️ ARQUIVADA E SO LEITURA PARA TODO MUNDO (D10, §9.4): a lista aparece, mas
 * nem o proprio botao "Seguir" vale -- o servidor recusa com 422
 * `tarefa_arquivada`.
 *
 * ⚠️ `podeGerenciar` VEM DO SERVIDOR (`task.can_manage_watchers`), e ausente
 * le-se como "nao": na duvida o `+` nao aparece, e o servidor recusaria de
 * qualquer forma.
 */
export function permissoesDeSeguidor({
  arquivada,
  podeGerenciar,
}: {
  arquivada: boolean;
  podeGerenciar: boolean | undefined;
}): PermissoesDeSeguidor {
  if (arquivada) return { seguirASiMesmo: false, mexerEmOutros: false };
  return { seguirASiMesmo: true, mexerEmOutros: podeGerenciar === true };
}

/** O rotulo do botao do topo (D1). */
export function rotuloDoBotaoSeguir(sigo: boolean): string {
  return sigo ? "Deixar de seguir" : "Seguir";
}

/**
 * A frase do aviso quando por ou tirar alguem falha.
 *
 * `daPropriaPessoa` = o gesto foi o botao "Seguir" (voce mesmo), e nao o `+`.
 */
export function mensagemDeFalha(
  erro: { status?: number; code?: string },
  daPropriaPessoa: boolean,
): string {
  if (erro.code === "tarefa_arquivada") {
    return "Tarefa arquivada: os seguidores não podem mudar.";
  }
  if (erro.status === 403) return "Você não pode mudar quem segue esta tarefa.";
  if (erro.status === 422) return "Essa pessoa não alcança esta tarefa (fora do time).";
  return daPropriaPessoa
    ? "Não consegui atualizar se você segue esta tarefa."
    : "Não consegui atualizar os seguidores.";
}
