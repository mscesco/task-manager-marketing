// Mantém ?task=<id> na URL em sincronia com a tarefa aberta.
//
// `replaceState`, não `pushState`: o F5 e a barra de endereço guardam a
// tarefa, mas o Voltar continua saindo da página. Nem `router.replace`: é só
// cosmética de URL na mesma rota, sem remontar nada.
//
// O link da barra carrega o contexto (quadro, projeto) e pode esbarrar na
// guarda de lente; para compartilhar, use "Copiar link" (/tarefa/<id>).

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
