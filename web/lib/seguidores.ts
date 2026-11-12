// As regras da tela de seguir uma tarefa (no backend, `watcher`): o que a
// lista oferece, quem pode o quê e a frase de falha.

/** Uma pessoa na lista de escolha. `inativo` so aparece em quem JA segue. */
export type PessoaOferecida = { id: string; name: string; inativo: boolean };

/**
 * Quem a lista de "Seguidores" oferece, ja filtrado pela busca e em ordem de
 * nome.
 *
 * Desativado e quem não alcança a tarefa saem da lista, menos quem já segue:
 * senão não haveria como tirá-lo.
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
 * Arquivada é só leitura para todo mundo. `podeGerenciar` vem do servidor
 * (`task.can_manage_watchers`); ausente é "não".
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

/** O rotulo do botao do topo. */
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
