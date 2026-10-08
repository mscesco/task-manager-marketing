// lib/gravacoesDaBase.ts
// As gravações de LINHA da Base que ainda não voltaram do servidor (célula,
// criar, apagar) -- por base.
//
// ⚠️ EXISTE POR CAUSA DE DUAS CORRIDAS (revisão de 08/10):
// 1. Recarga x gravação: um aviso do ao vivo dispara a recarga; se o GET lê o
//    banco ANTES do PATCH confirmar e responde DEPOIS, a célula que a pessoa
//    acabou de editar volta ao valor antigo na tela -- e o eco da própria ação
//    não chega para corrigir. A recarga espera (`haGravando`) e descarta a
//    resposta se alguma gravação começou no meio (`geracao`).
// 2. Ctrl+Z x gravação: desfazer logo depois de editar desfazia a ação
//    ANTERIOR -- a edição ainda nem tinha chegado. O desfazer espera
//    (`esperarGravacoes`).
//
// Estado de módulo, e não de componente: a tabela, o quadro e o calendário
// gravam por caminhos diferentes, e a página é quem precisa saber.

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
