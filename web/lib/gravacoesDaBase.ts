// As gravações de linha da Base que ainda não voltaram do servidor, por base.
// Duas corridas:
// 1. Recarga x gravação: um GET que lê antes do PATCH e responde depois
//    voltaria a célula ao valor antigo. A recarga espera (`haGravando`) e
//    descarta a resposta se uma gravação começou no meio (`geracao`).
// 2. Ctrl+Z x gravação: desfazer logo depois de editar desfaria a ação
//    anterior. O desfazer espera (`esperarGravacoes`).
// Estado de módulo porque tabela, quadro e calendário gravam por caminhos
// diferentes.

const emCurso = new Map<string, Set<Promise<unknown>>>();
const geracoes = new Map<string, number>();

/** Registra a gravação e a devolve, intacta (o erro continua de quem chamou). */
export function acompanhar<T>(baseId: string, gravacao: Promise<T>): Promise<T> {
  let lista = emCurso.get(baseId);
  if (!lista) emCurso.set(baseId, (lista = new Set()));
  lista.add(gravacao);
  geracoes.set(baseId, geracao(baseId) + 1);
  const tirar = () => {
    lista.delete(gravacao);
  };
  gravacao.then(tirar, tirar);
  return gravacao;
}

export function haGravando(baseId: string): boolean {
  return (emCurso.get(baseId)?.size ?? 0) > 0;
}

/** Sobe a cada gravação que começa: a recarga compara antes e depois. */
export function geracao(baseId: string): number {
  return geracoes.get(baseId) ?? 0;
}

/** Espera as gravações em curso -- deram certo ou não. */
export async function esperarGravacoes(baseId: string): Promise<void> {
  await Promise.allSettled([...(emCurso.get(baseId) ?? [])]);
}
