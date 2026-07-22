// Mantem ?task=<id> na URL em sincronia com a tarefa aberta na tela.
//
// Por que replaceState e NAO pushState: a URL passa a refletir o que esta
// aberto -- da pra copiar da barra de endereco e o F5 nao perde a tarefa --
// mas o botao Voltar do navegador continua saindo da pagina, em vez de virar
// um "desfazer" de cada abertura. Abrir e fechar 10 tarefas seguidas nao
// entope o historico com 10 entradas que a pessoa teria que desandar.
//
// Por que nao router.push/replace do Next: aqui nao ha navegacao -- e so
// cosmetica de URL sobre a MESMA rota. replaceState e sincrono, nao dispara o
// ciclo de navegacao do App Router e nao remonta nada. (Next 14.1+ suporta
// oficialmente mexer no history direto; a versao daqui e a 14.2.)
//
// ATENCAO -- o link da barra de endereco NAO e o link canonico de
// compartilhamento. Ele carrega o contexto de onde a pessoa estava
// (/quadro/<subtime>?task=, /projetos/<id>?task=) e quem receber pode esbarrar
// na guarda de lente daquele quadro mesmo podendo ver a tarefa. Pra
// compartilhar, o certo continua sendo o botao "Copiar link" (/tarefa/<id>),
// que nao depende de contexto nenhum.

/** Grava (ou remove) o ?task= na URL atual, sem navegar. */
export function sincronizarTaskNaUrl(taskId: string | null): void {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  const atual = url.searchParams.get("task");

  if (taskId) {
    if (atual === taskId) return; // ja esta certo -> nao chama replaceState atoa
    url.searchParams.set("task", taskId);
  } else {
    if (atual === null) return; // ja nao tem -> idem
    url.searchParams.delete("task");
  }

  // Preserva history.state: o App Router guarda estado proprio ali. Passar
  // null faria o router perder a referencia da rota atual.
  window.history.replaceState(window.history.state, "", url.toString());
}

/** Le o ?task= da URL atual (null se ausente). */
export function lerTaskDaUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("task");
}
